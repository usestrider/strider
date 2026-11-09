/** The recursive by-value argument decoder, evaluated in the destination realm. */
export const decoder = String.raw`((BigIntType, DateType, RegExpType, SetType, MapType) => {
  const defineProperty = Object.defineProperty
  return function deserialize(value) {
    switch (value.type) {
      case "undefined": return undefined
      case "null": return null
      case "string":
      case "boolean": return value.value
      case "number":
        return typeof value.value === "number" ? value.value : value.value === "-0" ? -0 : Number(value.value)
      case "bigint": return BigIntType(value.value)
      case "date": return new DateType(value.value)
      case "regexp": return new RegExpType(value.value.pattern, value.value.flags)
      case "array": {
        const items = []
        const list = value.value || []
        for (let i = 0; i < list.length; i++) items.push(deserialize(list[i]))
        return items
      }
      case "set": {
        const set = new SetType()
        const list = value.value || []
        for (let i = 0; i < list.length; i++) set.add(deserialize(list[i]))
        return set
      }
      case "map": {
        const map = new MapType()
        const list = value.value || []
        for (let i = 0; i < list.length; i++) {
          map.set(typeof list[i][0] === "string" ? list[i][0] : deserialize(list[i][0]), deserialize(list[i][1]))
        }
        return map
      }
      case "object": {
        const object = {}
        const list = value.value || []
        for (let i = 0; i < list.length; i++) {
          defineProperty(object, typeof list[i][0] === "string" ? list[i][0] : String(deserialize(list[i][0])), {
            value: deserialize(list[i][1]), enumerable: true, configurable: true, writable: true
          })
        }
        return object
      }
      default:
        throw new TypeError("A " + value.type + " can't be passed by value; pass a handle")
    }
  }
})(BigInt, Date, RegExp, Set, Map)`

/**
 * Reconstructs value arguments while leaving remote handles and nodes untouched. The callback is constructed
 * outside the wrapper's scope so its free names (including an arrow's arguments) resolve in the realm.
 */
export const call = (fn: string): string =>
  `((fn, decode) => function(kinds, ...args) { return Reflect.apply(fn, this, args.map((arg, i) => kinds[i] === "v" ? decode(arg) : arg)) })((${fn}), ${decoder})`
