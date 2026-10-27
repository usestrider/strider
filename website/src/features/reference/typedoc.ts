// The parts of TypeDoc's JSON output (schema 2.0) the reference reads. TypeDoc's own `JSONOutput` types describe
// the same shapes; these are narrowed to what the pages use, so the site needs no TypeDoc install.

export const Kind = {
  Project: 0x1,
  Module: 0x2,
  Namespace: 0x4,
  Enum: 0x8,
  EnumMember: 0x10,
  Variable: 0x20,
  Function: 0x40,
  Class: 0x80,
  Interface: 0x100,
  Constructor: 0x200,
  Property: 0x400,
  Method: 0x800,
  CallSignature: 0x1000,
  IndexSignature: 0x2000,
  ConstructorSignature: 0x4000,
  Parameter: 0x8000,
  TypeLiteral: 0x10000,
  TypeParameter: 0x20000,
  Accessor: 0x40000,
  GetSignature: 0x80000,
  SetSignature: 0x100000,
  TypeAlias: 0x200000,
  Reference: 0x400000
} as const

export interface Flags {
  readonly isOptional?: boolean
  readonly isRest?: boolean
  readonly isReadonly?: boolean
  readonly isConst?: boolean
  readonly isStatic?: boolean
  readonly isAbstract?: boolean
}

export interface Source {
  readonly fileName: string
  readonly line: number
  readonly character: number
  readonly url?: string
}

export type DisplayPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "inline-tag"; readonly tag: string; readonly text: string; readonly target?: unknown }
  | { readonly kind: "relative-link"; readonly text: string }

export interface Comment {
  readonly summary: ReadonlyArray<DisplayPart>
  readonly blockTags?: ReadonlyArray<{ readonly tag: string; readonly content: ReadonlyArray<DisplayPart> }>
  readonly modifierTags?: ReadonlyArray<string>
}

export interface Reflection {
  readonly id: number
  readonly name: string
  readonly kind: number
  readonly flags: Flags
  readonly comment?: Comment
  readonly sources?: ReadonlyArray<Source>
  readonly children?: ReadonlyArray<Reflection>
  readonly signatures?: ReadonlyArray<Signature>
  readonly indexSignatures?: ReadonlyArray<Signature>
  readonly getSignature?: Signature
  readonly setSignature?: Signature
  readonly typeParameters?: ReadonlyArray<TypeParameter>
  readonly type?: Type
  readonly extendedTypes?: ReadonlyArray<Type>
  readonly implementedTypes?: ReadonlyArray<Type>
  readonly inheritedFrom?: Type
  readonly defaultValue?: string
  /** A re-export (`Kind.Reference`) names the reflection it re-exports */
  readonly target?: number
}

export interface Signature {
  readonly id: number
  readonly name: string
  readonly kind: number
  readonly flags: Flags
  readonly comment?: Comment
  readonly sources?: ReadonlyArray<Source>
  readonly typeParameters?: ReadonlyArray<TypeParameter>
  readonly parameters?: ReadonlyArray<Parameter>
  readonly type?: Type
}

export interface Parameter {
  readonly id: number
  readonly name: string
  readonly flags: Flags
  readonly type?: Type
  readonly defaultValue?: string
}

export interface TypeParameter {
  readonly id: number
  readonly name: string
  readonly flags: Flags & { readonly isConst?: boolean }
  readonly type?: Type
  readonly default?: Type
  readonly varianceModifier?: "in" | "out" | "in out"
}

export type ReferenceTarget = number | {
  readonly packageName: string
  readonly packagePath?: string
  readonly qualifiedName: string
}

export type Type =
  | { readonly type: "intrinsic"; readonly name: string }
  | { readonly type: "literal"; readonly value: string | number | boolean | null | BigIntLiteral }
  | {
    readonly type: "reference"
    readonly name: string
    readonly target: ReferenceTarget
    readonly typeArguments?: ReadonlyArray<Type>
    readonly package?: string
    readonly qualifiedName?: string
    readonly refersToTypeParameter?: boolean
    readonly preferValues?: boolean
  }
  | { readonly type: "union"; readonly types: ReadonlyArray<Type> }
  | { readonly type: "intersection"; readonly types: ReadonlyArray<Type> }
  | { readonly type: "array"; readonly elementType: Type }
  | { readonly type: "tuple"; readonly elements?: ReadonlyArray<Type> }
  | { readonly type: "namedTupleMember"; readonly name: string; readonly isOptional: boolean; readonly element: Type }
  | { readonly type: "optional"; readonly elementType: Type }
  | { readonly type: "rest"; readonly elementType: Type }
  | { readonly type: "reflection"; readonly declaration: Reflection }
  | { readonly type: "query"; readonly queryType: Type }
  | { readonly type: "typeOperator"; readonly operator: string; readonly target: Type }
  | { readonly type: "indexedAccess"; readonly objectType: Type; readonly indexType: Type }
  | {
    readonly type: "conditional"
    readonly checkType: Type
    readonly extendsType: Type
    readonly trueType: Type
    readonly falseType: Type
  }
  | { readonly type: "inferred"; readonly name: string; readonly constraint?: Type }
  | {
    readonly type: "mapped"
    readonly parameter: string
    readonly parameterType: Type
    readonly templateType: Type
    readonly readonlyModifier?: "+" | "-"
    readonly optionalModifier?: "+" | "-"
    readonly nameType?: Type
  }
  | { readonly type: "predicate"; readonly name: string; readonly asserts: boolean; readonly targetType?: Type }
  | {
    readonly type: "templateLiteral"
    readonly head: string
    readonly tail: ReadonlyArray<readonly [Type, string]>
  }
  | { readonly type: "unknown"; readonly name: string }

export interface BigIntLiteral {
  readonly negative: boolean
  readonly value: string
}

export interface Project {
  readonly schemaVersion: string
  readonly name: string
  readonly children?: ReadonlyArray<Reflection>
}
