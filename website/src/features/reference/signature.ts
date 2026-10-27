// Prints TypeDoc's reflections back as TypeScript declarations: `declare const`, `declare function`, `interface`,
// `type` and `declare class`, with every reference to a documented declaration linked. Names are written as the
// library's code writes them: a declaration of another Effect-style module is qualified by its module
// (`Schema.Struct`, `Effect.Effect`, `Reason.InvalidInput`), one of this module is not.
import type { Doc } from "./doc.ts"
import { bracketed, choice, concat, flat, group, ifBreak, indent, join, line, link, softline } from "./doc.ts"
import type { Parameter, ReferenceTarget, Reflection, Signature, Type, TypeParameter } from "./typedoc.ts"
import { Kind } from "./typedoc.ts"

export interface Context {
  /** The package and source file of the module being printed, e.g. `@usestrider/browser` and `src/Page.ts` */
  readonly packageName: string
  readonly source: string
  /** Where a reference links, if it names a documented declaration */
  readonly href: (target: ReferenceTarget) => string | undefined
}

type Reference = Extract<Type, { readonly type: "reference" }>

const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name)

const propertyName = (name: string) => {
  if (name.startsWith("[")) return name
  // TypeDoc names a symbol-keyed member `__@TypeId@123`
  const symbol = /^__@(.+?)(?:@\d+)?$/.exec(name)
  if (symbol !== null) return `[${symbol[1]}]`
  return isIdentifier(name) ? name : JSON.stringify(name)
}

// `src/Schema.ts` and `src/unstable/http/HttpClient.ts` are Effect-style modules, whose declarations code reaches
// through the module's namespace; `src/internal/effect.ts` is not
const moduleOf = (packagePath: string | undefined) => {
  if (packagePath === undefined || packagePath.split("/").includes("internal")) return undefined
  return /(?:^|\/)([A-Z][A-Za-z0-9]*)(?:\.d)?\.ts$/.exec(packagePath)?.[1]
}

const referenceName = (type: Reference, context: Context) => {
  const { target } = type
  if (typeof target === "number" || type.refersToTypeParameter === true) return type.name
  // Written qualified at the use site, as in `typeof DocumentStatus.Type`
  if (type.name.includes(".")) return type.name
  if (target.packageName === "typescript") return type.name
  const module = moduleOf(target.packagePath)
  if (module === undefined) return target.qualifiedName
  const sameModule = target.packageName === context.packageName && target.packagePath === context.source
  return sameModule ? target.qualifiedName : `${module}.${target.qualifiedName}`
}

const literal = (value: Extract<Type, { readonly type: "literal" }>["value"]) => {
  if (value === null) return "null"
  if (typeof value === "object") return `${value.negative ? "-" : ""}${value.value}n`
  return typeof value === "string" ? JSON.stringify(value) : String(value)
}

const isFunctionType = (type: Type) =>
  type.type === "reflection" && type.declaration.signatures !== undefined && type.declaration.children === undefined
  && type.declaration.indexSignatures === undefined && type.declaration.signatures.length === 1

// Where a type needs parentheses: as an array's element, a union's or intersection's member, or an operator's operand
const needsParens = (type: Type, position: "array" | "union" | "intersection" | "operator") => {
  switch (type.type) {
    case "union":
      return position !== "union"
    case "intersection":
      return position === "array" || position === "operator"
    case "conditional":
      return true
    case "typeOperator":
      return position === "array"
    case "reflection":
      return isFunctionType(type)
    default:
      return false
  }
}

const operand = (type: Type, position: Parameters<typeof needsParens>[1], context: Context): Doc =>
  needsParens(type, position) ? concat("(", printType(type, context), ")") : printType(type, context)

export const printType = (type: Type, context: Context): Doc => {
  switch (type.type) {
    case "intrinsic":
    case "unknown":
      return type.name
    case "literal":
      return literal(type.value)
    case "reference": {
      const name = link(
        referenceName(type, context),
        type.refersToTypeParameter === true ? undefined : context.href(type.target)
      )
      const args = type.typeArguments ?? []
      return args.length === 0 ? name : concat(name, typeArguments(args, context))
    }
    case "union": {
      const members = type.types.map((member) => operand(member, "union", context))
      return group(indent(concat(softline, ifBreak("| "), join(concat(line, "| "), members))))
    }
    case "intersection":
      return group(join(concat(line, "& "), type.types.map((member) => operand(member, "intersection", context))))
    case "array":
      return concat(operand(type.elementType, "array", context), "[]")
    case "tuple":
      return bracketed("[", (type.elements ?? []).map((element) => printType(element, context)), "]")
    case "namedTupleMember":
      return concat(type.name, type.isOptional ? "?: " : ": ", printType(type.element, context))
    case "optional":
      return concat(operand(type.elementType, "array", context), "?")
    case "rest":
      return concat("...", printType(type.elementType, context))
    case "reflection":
      return typeLiteral(type.declaration, context)
    case "query":
      return concat("typeof ", printType(type.queryType, context))
    case "typeOperator":
      return concat(type.operator, " ", operand(type.target, "operator", context))
    case "indexedAccess":
      return concat(operand(type.objectType, "array", context), "[", printType(type.indexType, context), "]")
    case "conditional":
      return group(concat(
        operand(type.checkType, "operator", context),
        " extends ",
        operand(type.extendsType, "operator", context),
        indent(concat(line, "? ", printType(type.trueType, context), line, ": ", printType(type.falseType, context)))
      ))
    case "inferred":
      return type.constraint === undefined
        ? concat("infer ", type.name)
        : concat("infer ", type.name, " extends ", printType(type.constraint, context))
    case "mapped": {
      const readonly = type.readonlyModifier === "+" ? "readonly " : type.readonlyModifier === "-" ? "-readonly " : ""
      const optional = type.optionalModifier === "+" ? "?" : type.optionalModifier === "-" ? "-?" : ""
      const as = type.nameType === undefined ? "" : concat(" as ", printType(type.nameType, context))
      return group(concat(
        "{",
        indent(concat(
          line,
          readonly,
          "[",
          type.parameter,
          " in ",
          printType(type.parameterType, context),
          as,
          "]",
          optional,
          ": ",
          printType(type.templateType, context)
        )),
        line,
        "}"
      ))
    }
    case "predicate": {
      const prefix = type.asserts ? `asserts ${type.name}` : type.name
      return type.targetType === undefined ? prefix : concat(prefix, " is ", printType(type.targetType, context))
    }
    case "templateLiteral":
      return concat(
        "`",
        escapeTemplate(type.head),
        ...type.tail.flatMap(([inner, text]) => [concat("${", printType(inner, context), "}"), escapeTemplate(text)]),
        "`"
      )
  }
}

const escapeTemplate = (text: string) => text.replace(/[`\\]/g, "\\$&").replace(/\$\{/g, "\\${")

// A lone object type hugs its brackets, `Schema.Struct<{` … `}>`, rather than taking a line of its own
const isObjectLiteral = (type: Type) => type.type === "reflection" && !isFunctionType(type)

export const typeArguments = (args: ReadonlyArray<Type>, context: Context): Doc =>
  args.length === 1 && isObjectLiteral(args[0]!)
    ? concat("<", printType(args[0]!, context), ">")
    : bracketed("<", args.map((arg) => printType(arg, context)), ">")

const typeParameter = (parameter: TypeParameter, context: Context): Doc =>
  concat(
    parameter.flags.isConst === true ? "const " : "",
    parameter.varianceModifier === undefined ? "" : `${parameter.varianceModifier} `,
    parameter.name,
    parameter.type === undefined ? "" : concat(" extends ", printType(parameter.type, context)),
    parameter.default === undefined ? "" : concat(" = ", printType(parameter.default, context))
  )

export const typeParameters = (parameters: ReadonlyArray<TypeParameter> | undefined, context: Context): Doc =>
  parameters === undefined || parameters.length === 0
    ? ""
    : bracketed("<", parameters.map((parameter) => typeParameter(parameter, context)), ">")

const parameter = (p: Parameter, context: Context): Doc => {
  const rest = p.flags.isRest === true
  const optional = p.flags.isOptional === true || (p.defaultValue !== undefined && !rest)
  return concat(
    rest ? "..." : "",
    p.name,
    optional ? "?" : "",
    ": ",
    p.type === undefined ? "unknown" : printType(p.type, context)
  )
}

const parameters = (signature: Signature, context: Context): Doc =>
  bracketed("(", (signature.parameters ?? []).map((p) => parameter(p, context)), ")")

const returnType = (signature: Signature, context: Context): Doc =>
  signature.type === undefined ? "void" : printType(signature.type, context)

// A signature on one line if it fits; otherwise its parameters on the first line, if they fit there, and the return
// type broken; otherwise one parameter a line, then the return type, which breaks only if it still doesn't fit. Breaking whichever group comes last, as a plain group would, splits the return type's type
// arguments and leaves the parameters on one long line.
const signatureLayout = (signature: Signature, context: Context, prefix: Doc, arrow: string): Doc => {
  const head = concat(prefix, typeParameters(signature.typeParameters, context))
  const tail = concat(arrow, returnType(signature, context))
  const items = (signature.parameters ?? []).map((p) => parameter(p, context))
  const oneLine = concat(head, "(", join(", ", items), ")", tail)
  if (items.length === 0) return choice(oneLine, group(concat(head, "()", tail)))
  return choice(
    oneLine,
    // `snapshot(options?: Snapshot.Options): Effect.Effect<` fits, so only the return type breaks
    concat(flat(concat(head, "(", join(", ", items), ")")), group(tail)),
    concat(head, group(concat("(", indent(concat(line, join(concat(",", line), items))), line, ")"), true), group(tail))
  )
}

/** `<A>(a: A): B`, as a method or call signature is written */
const callSignature = (signature: Signature, context: Context, prefix: Doc = ""): Doc =>
  signatureLayout(signature, context, prefix, ": ")

/** `<A>(a: A) => B`, as a function type is written */
const functionType = (signature: Signature, context: Context): Doc =>
  signatureLayout(signature, context, signature.kind === Kind.ConstructorSignature ? "new " : "", " => ")

const indexSignature = (signature: Signature, context: Context): Doc => {
  const key = signature.parameters?.[0]
  return concat(
    signature.flags.isReadonly === true ? "readonly " : "",
    "[",
    key?.name ?? "key",
    ": ",
    key?.type === undefined ? "string" : printType(key.type, context),
    "]: ",
    returnType(signature, context)
  )
}

/** Each line of an object type's or interface's body: properties, methods, accessors and signatures */
const members = (declaration: Reflection, context: Context, own: boolean): Array<Doc> => {
  const out: Array<Doc> = []
  for (const signature of declaration.signatures ?? []) {
    out.push(callSignature(signature, context, signature.kind === Kind.ConstructorSignature ? "new " : ""))
  }
  for (const signature of declaration.indexSignatures ?? []) out.push(indexSignature(signature, context))
  for (const child of sortBySource(declaration.children ?? [])) {
    if (own && child.inheritedFrom !== undefined) continue
    if (isBrand(child)) continue
    out.push(...member(child, context))
  }
  return out
}

// A string TypeId brand, `readonly "~@usestrider/browser/Page/PageError": …`, identifies the type to the library;
// no one reads or writes it
const isBrand = (child: Reflection) => child.name.startsWith("~")

const member = (child: Reflection, context: Context): Array<Doc> => {
  const name = propertyName(child.name)
  const optional = child.flags.isOptional === true ? "?" : ""
  const modifiers = `${child.flags.isStatic === true ? "static " : ""}${
    child.flags.isReadonly === true ? "readonly " : ""
  }`
  switch (child.kind) {
    case Kind.Method:
      return (child.signatures ?? []).map((signature) =>
        callSignature(signature, context, `${modifiers}${name}${optional}`)
      )
    case Kind.Constructor:
      return (child.signatures ?? []).map((signature) => group(concat("constructor", parameters(signature, context))))
    case Kind.Accessor: {
      const out: Array<Doc> = []
      if (child.getSignature !== undefined) {
        out.push(concat("get ", name, "(): ", returnType(child.getSignature, context)))
      }
      if (child.setSignature !== undefined) out.push(concat("set ", name, parameters(child.setSignature, context)))
      return out
    }
    default:
      return [
        concat(modifiers, name, optional, ": ", child.type === undefined ? "unknown" : printType(child.type, context))
      ]
  }
}

/** `{ a: A; b: B }` on one line, or one member a line */
const typeLiteral = (declaration: Reflection, context: Context): Doc => {
  if (isFunctionType({ type: "reflection", declaration })) return functionType(declaration.signatures![0]!, context)
  const body = members(declaration, context, false)
  if (body.length === 0) return "{}"
  return group(concat("{", indent(concat(line, join(concat(ifBreak("", ";"), line), body))), line, "}"))
}

/** An interface's or class's body, always one member a line */
const body = (items: ReadonlyArray<Doc>): Doc =>
  items.length === 0 ? " {}" : group(concat(" {", indent(concat(line, join(line, items))), line, "}"), true)

// `interface A extends B, C {` on one line if it fits; otherwise the clause on a line of its own, then one type a line
const heritage = (keyword: string, types: ReadonlyArray<Type> | undefined, context: Context): Doc => {
  // A Schema class extends what its base call returns, which TypeDoc gives as the type it resolved to: an
  // intersection or object type no one wrote. Only named bases are shown.
  const named = (types ?? []).filter((type) => type.type === "reference").map((type) => printType(type, context))
  if (named.length === 0) return ""
  return choice(
    flat(concat(` ${keyword} `, join(", ", named))),
    indent(concat(line, keyword, " ", indent(group(join(concat(",", line), named)))))
  )
}

// A class that extends a call, as a Schema class does (`Schema.TaggedError<PageError>(…)("PageError", { … })`),
// is printed with that call as its source writes it: TypeDoc names each inherited member after it, as
// `<expression>.<member>`, while its `extendedTypes` give only the type the call returned
const baseExpression = (reflection: Reflection) => {
  if ((reflection.extendedTypes ?? []).every((type) => type.type === "reference")) return undefined
  for (const child of reflection.children ?? []) {
    const from = child.inheritedFrom
    if (from?.type !== "reference" || !from.name.endsWith(`.${child.name}`)) continue
    const expression = from.name.slice(0, -child.name.length - 1)
    if (expression.includes("(")) return expression
  }
  return undefined
}

export const sortBySource = (reflections: ReadonlyArray<Reflection>): Array<Reflection> =>
  [...reflections].sort((a, b) => {
    const [x, y] = [a.sources?.[0], b.sources?.[0]]
    if (x === undefined || y === undefined) return 0
    return x.fileName === y.fileName ? x.line - y.line || x.character - y.character : 0
  })

export interface Options {
  /** An interface's or class's body as `{ … }`, where its members are listed apart */
  readonly elideBody?: boolean | undefined
}

/** The declaration as `.d.ts` would write it; a function with overloads gives one per signature */
export const declaration = (reflection: Reflection, context: Context, options?: Options): Array<Doc> => {
  const name = reflection.name
  switch (reflection.kind) {
    case Kind.Variable:
      return [group(concat(
        reflection.flags.isConst === true ? "declare const " : "declare let ",
        name,
        ": ",
        reflection.type === undefined ? "unknown" : printType(reflection.type, context)
      ))]
    case Kind.Function:
      return (reflection.signatures ?? []).map((signature) =>
        callSignature(signature, context, `declare function ${name}`)
      )
    case Kind.TypeAlias:
      return [group(concat(
        "type ",
        name,
        typeParameters(reflection.typeParameters, context),
        " = ",
        reflection.type === undefined ? "unknown" : printType(reflection.type, context)
      ))]
    case Kind.Interface:
      return [concat(
        "interface ",
        name,
        typeParameters(reflection.typeParameters, context),
        heritage("extends", reflection.extendedTypes, context),
        options?.elideBody === true ? " { … }" : body(members(reflection, context, true))
      )]
    case Kind.Class: {
      const base = baseExpression(reflection)
      return [concat(
        reflection.flags.isAbstract === true ? "declare abstract class " : "declare class ",
        name,
        typeParameters(reflection.typeParameters, context),
        base === undefined ? heritage("extends", reflection.extendedTypes, context) : ` extends ${base}`,
        heritage("implements", reflection.implementedTypes, context),
        options?.elideBody === true ? " { … }" : body(members(reflection, context, true))
      )]
    }
    case Kind.Enum:
      return [concat(
        "declare enum ",
        name,
        body(
          sortBySource(reflection.children ?? []).map((child) =>
            child.type === undefined ? child.name : concat(child.name, " = ", printType(child.type, context))
          )
        )
      )]
    case Kind.Namespace:
      return [concat("declare namespace ", name)]
    default:
      return reflection.type === undefined ? [] : [printType(reflection.type, context)]
  }
}

/** A member of an interface or class, alone, as its declaration in the body would read */
export const memberDeclaration = (reflection: Reflection, context: Context): Array<Doc> => member(reflection, context)
