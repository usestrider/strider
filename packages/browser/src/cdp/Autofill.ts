/**
 * Defines commands and events for Autofill.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Page from "./Page.ts"

/**
 * `Address`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Address {
  /**
   * fields and values defining an address.
   */
  readonly fields: ReadonlyArray<AddressField>
}

/**
 * Schema for `Address`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Address = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fields: Schema.Array(AddressField)
  }).annotate({ identifier: "Autofill.Address" })
) as any as Schema.Codec<Address>

/**
 * `AddressField`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddressField {
  /**
   * address field name, for example GIVEN_NAME.
   * The full list of supported field names:
   * https://source.chromium.org/chromium/chromium/src/+/main:components/autofill/core/browser/field_types.cc;l=38
   */
  readonly name: string
  /**
   * address field value, for example Jon Doe.
   */
  readonly value: string
}

/**
 * Schema for `AddressField`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddressField = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "Autofill.AddressField" })
) as any as Schema.Codec<AddressField>

/**
 * A list of address fields.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddressFields {
  readonly fields: ReadonlyArray<AddressField>
}

/**
 * Schema for `AddressFields`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddressFields = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fields: Schema.Array(AddressField)
  }).annotate({ identifier: "Autofill.AddressFields" })
) as any as Schema.Codec<AddressFields>

/**
 * Defines how an address can be displayed like in chrome://settings/addresses.
 * Address UI is a two dimensional array, each inner array is an "address information line", and when rendered in a UI surface should be displayed as such.
 * The following address UI for instance:
 * [[{name: "GIVE_NAME", value: "Jon"}, {name: "FAMILY_NAME", value: "Doe"}], [{name: "CITY", value: "Munich"}, {name: "ZIP", value: "81456"}]]
 * should allow the receiver to render:
 * Jon Doe
 * Munich 81456
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddressUI {
  /**
   * A two dimension array containing the representation of values from an address profile.
   */
  readonly addressFields: ReadonlyArray<AddressFields>
}

/**
 * Schema for `AddressUI`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddressUI = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    addressFields: Schema.Array(AddressFields)
  }).annotate({ identifier: "Autofill.AddressUI" })
) as any as Schema.Codec<AddressUI>

/**
 * `CreditCard`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CreditCard {
  /**
   * 16-digit credit card number.
   */
  readonly number: string
  /**
   * Name of the credit card owner.
   */
  readonly name: string
  /**
   * 2-digit expiry month.
   */
  readonly expiryMonth: string
  /**
   * 4-digit expiry year.
   */
  readonly expiryYear: string
  /**
   * 3-digit card verification code.
   */
  readonly cvc: string
}

/**
 * Schema for `CreditCard`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CreditCard = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    number: Schema.String,
    name: Schema.String,
    expiryMonth: Schema.String,
    expiryYear: Schema.String,
    cvc: Schema.String
  }).annotate({ identifier: "Autofill.CreditCard" })
) as any as Schema.Codec<CreditCard>

/**
 * `FilledField`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FilledField {
  /**
   * The type of the field, e.g text, password etc.
   */
  readonly htmlType: string
  /**
   * the html id
   */
  readonly id: string
  /**
   * the html name
   */
  readonly name: string
  /**
   * the field value
   */
  readonly value: string
  /**
   * The actual field type, e.g FAMILY_NAME
   */
  readonly autofillType: string
  /**
   * The filling strategy
   */
  readonly fillingStrategy: FillingStrategy
  /**
   * The frame the field belongs to
   */
  readonly frameId: Page.FrameId
  /**
   * The form field's DOM node
   */
  readonly fieldId: DOM.BackendNodeId
}

/**
 * Schema for `FilledField`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FilledField = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    htmlType: Schema.String,
    id: Schema.String,
    name: Schema.String,
    value: Schema.String,
    autofillType: Schema.String,
    fillingStrategy: FillingStrategy,
    frameId: Page.FrameId,
    fieldId: DOM.BackendNodeId
  }).annotate({ identifier: "Autofill.FilledField" })
) as any as Schema.Codec<FilledField>

/**
 * Specified whether a filled field was done so by using the html autocomplete attribute or autofill heuristics.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type FillingStrategy =
  | "autocompleteAttribute"
  | "autofillInferred"
  | (string & {})

/**
 * Schema for `FillingStrategy`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FillingStrategy = Schema.String as any as Schema.Codec<FillingStrategy>

/**
 * Emitted when an address form is filled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddressFormFilledParams {
  /**
   * Information about the fields that were filled
   */
  readonly filledFields: ReadonlyArray<FilledField>
  /**
   * An UI representation of the address used to fill the form.
   * Consists of a 2D array where each child represents an address/profile line.
   */
  readonly addressUi: AddressUI
}

/**
 * Schema for `AddressFormFilledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddressFormFilledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    filledFields: Schema.Array(FilledField),
    addressUi: AddressUI
  }).annotate({ identifier: "Autofill.AddressFormFilledParams" })
) as any as Schema.Codec<AddressFormFilledParams>

/**
 * Set addresses so that developers can verify their forms implementation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetAddressesParams {
  readonly addresses: ReadonlyArray<Address>
}

/**
 * Schema for `SetAddressesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetAddressesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    addresses: Schema.Array(Address)
  }).annotate({ identifier: "Autofill.SetAddressesParams" })
) as any as Schema.Codec<SetAddressesParams>

/**
 * Trigger autofill on a form identified by the fieldId.
 * If the field and related form cannot be autofilled, returns an error.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TriggerParams {
  /**
   * Identifies a field that serves as an anchor for autofill.
   */
  readonly fieldId: DOM.BackendNodeId
  /**
   * Identifies the frame that field belongs to.
   */
  readonly frameId?: Page.FrameId | undefined
  /**
   * Credit card information to fill out the form. Credit card data is not saved.  Mutually exclusive with `address`.
   */
  readonly card?: CreditCard | undefined
  /**
   * Address to fill out the form. Address data is not saved. Mutually exclusive with `card`.
   */
  readonly address?: Address | undefined
}

/**
 * Schema for `TriggerParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TriggerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fieldId: DOM.BackendNodeId,
    frameId: Schema.optional(Page.FrameId),
    card: Schema.optional(CreditCard),
    address: Schema.optional(Address)
  }).annotate({ identifier: "Autofill.TriggerParams" })
) as any as Schema.Codec<TriggerParams>

/**
 * Disables autofill domain notifications.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Autofill.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Autofill.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables autofill domain notifications.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Autofill.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Autofill.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Set addresses so that developers can verify their forms implementation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setAddresses: Protocol.CommandDef<"Autofill.setAddresses", SetAddressesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Autofill.setAddresses",
    SetAddressesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Trigger autofill on a form identified by the fieldId.
 * If the field and related form cannot be autofilled, returns an error.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const trigger: Protocol.CommandDef<"Autofill.trigger", TriggerParams, void> = /*#__PURE__*/ Protocol.command(
  "Autofill.trigger",
  TriggerParams,
  undefined,
  { status: "stable" }
)

/**
 * Emitted when an address form is filled.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const addressFormFilled: Protocol.EventDef<"Autofill.addressFormFilled", AddressFormFilledParams> =
  /*#__PURE__*/ Protocol.event(
    "Autofill.addressFormFilled",
    AddressFormFilledParams,
    { status: "stable" }
  )
