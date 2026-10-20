/**
 * Parses the Chrome DevTools Protocol's JSON description into the protocol model.
 *
 * Everything in the spec is kept, deprecated items included: what to emit is the emitter's policy, recorded
 * in the coverage report. A `$ref` that doesn't resolve fails the parse.
 */
import type { Member, ProtocolModel, Shape, Status, Traits, TypeExpr } from "./Model.ts"
import { sorted } from "./Model.ts"

interface CdpItem {
  readonly description?: string
  readonly experimental?: boolean
  readonly deprecated?: boolean
}
interface CdpTypeLike extends CdpItem {
  readonly type?: string
  readonly $ref?: string
  readonly enum?: ReadonlyArray<string>
  readonly items?: CdpTypeLike
  readonly properties?: ReadonlyArray<CdpProperty>
}
interface CdpProperty extends CdpTypeLike {
  readonly name: string
  readonly optional?: boolean
}
interface CdpType extends CdpTypeLike {
  readonly id: string
}
interface CdpCommand extends CdpItem {
  readonly name: string
  readonly parameters?: ReadonlyArray<CdpProperty>
  readonly returns?: ReadonlyArray<CdpProperty>
  readonly redirect?: string
}
interface CdpEvent extends CdpItem {
  readonly name: string
  readonly parameters?: ReadonlyArray<CdpProperty>
}
interface CdpDomain extends CdpItem {
  readonly domain: string
  readonly dependencies?: ReadonlyArray<string>
  readonly types?: ReadonlyArray<CdpType>
  readonly commands?: ReadonlyArray<CdpCommand>
  readonly events?: ReadonlyArray<CdpEvent>
}
export interface CdpProtocol {
  readonly domains: ReadonlyArray<CdpDomain>
}

const status = (item: CdpItem): Status =>
  item.deprecated === true ? "deprecated" : item.experimental === true ? "experimental" : "stable"

const traits = (item: CdpItem, extra: Partial<Traits> = {}): Traits => ({
  status: status(item),
  ...(item.description === undefined ? {} : { description: item.description }),
  ...extra
})

/**
 * Parses one or more CDP JSON documents (the browser and JavaScript halves) into one model.
 */
export const parse = (revision: string, protocols: ReadonlyArray<CdpProtocol>): ProtocolModel => {
  const shapes: Record<string, Shape> = {}
  const domains: Record<string, ProtocolModel["domains"][string]> = {}
  const refs: Array<{ readonly from: string; readonly to: string }> = []

  const add = (id: string, shape: Shape) => {
    if (id in shapes) throw new Error(`Duplicate shape ${id}`)
    shapes[id] = shape
  }

  const typeOf = (domain: string, owner: string, spec: CdpTypeLike): TypeExpr => {
    if (spec.$ref !== undefined) {
      const to = spec.$ref.includes(".") ? spec.$ref.replace(".", "#") : `${domain}#${spec.$ref}`
      refs.push({ from: owner, to })
      return { _tag: "Ref", shape: to }
    }
    if (spec.enum !== undefined) {
      add(owner, { _tag: "Enum", values: spec.enum, traits: traits(spec) })
      return { _tag: "Ref", shape: owner }
    }
    switch (spec.type) {
      case "string":
      case "integer":
      case "number":
      case "boolean":
        return { _tag: "Scalar", scalar: spec.type }
      case "any":
        return { _tag: "Scalar", scalar: "unknown" }
      case "array": {
        if (spec.items === undefined) throw new Error(`${owner}: array without items`)
        return { _tag: "List", items: typeOf(domain, `${owner}.Item`, spec.items) }
      }
      case "object": {
        if (spec.properties === undefined) return { _tag: "Record" }
        add(owner, { _tag: "Struct", members: membersOf(domain, owner, spec.properties), traits: traits(spec) })
        return { _tag: "Ref", shape: owner }
      }
      default:
        throw new Error(`${owner}: unknown type ${String(spec.type)}`)
    }
  }

  const membersOf = (domain: string, owner: string, properties: ReadonlyArray<CdpProperty>) => {
    const members: Record<string, Member> = {}
    for (const property of properties) {
      members[property.name] = {
        type: typeOf(domain, `${owner}.${property.name}`, property),
        optional: property.optional === true,
        traits: traits(property)
      }
    }
    return members
  }

  const structOf = (domain: string, id: string, properties: ReadonlyArray<CdpProperty> | undefined, item: CdpItem) => {
    if (properties === undefined || properties.length === 0) return null
    add(id, { _tag: "Struct", members: membersOf(domain, id, properties), traits: traits(item) })
    return id
  }

  for (const protocol of protocols) {
    for (const domain of protocol.domains) {
      const name = domain.domain
      domains[name] = { dependencies: domain.dependencies ?? [], traits: traits(domain) }
      for (const type of domain.types ?? []) {
        const id = `${name}#${type.id}`
        if (type.enum !== undefined) {
          add(id, { _tag: "Enum", values: type.enum, traits: traits(type) })
        } else if (type.type === "object" && type.properties !== undefined) {
          add(id, { _tag: "Struct", members: membersOf(name, id, type.properties), traits: traits(type) })
        } else {
          add(id, { _tag: "Alias", type: typeOf(name, id, type), traits: traits(type) })
        }
      }
      for (const command of domain.commands ?? []) {
        const id = `${name}#${command.name}`
        add(id, {
          _tag: "Command",
          method: `${name}.${command.name}`,
          params: structOf(name, `${id}.Params`, command.parameters, command),
          result: structOf(name, `${id}.Result`, command.returns, command),
          traits: traits(command, command.redirect === undefined ? {} : { redirect: command.redirect })
        })
      }
      for (const event of domain.events ?? []) {
        const id = `${name}#${event.name}`
        add(id, {
          _tag: "Event",
          method: `${name}.${event.name}`,
          params: structOf(name, `${id}.Params`, event.parameters, event),
          traits: traits(event)
        })
      }
    }
  }

  for (const { from, to } of refs) {
    if (!(to in shapes)) throw new Error(`${from}: $ref ${to} doesn't resolve`)
  }
  return sorted({ backend: "cdp", revision, domains, shapes })
}
