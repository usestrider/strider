/**
 * This domain allows configuring virtual Bluetooth devices to test
 * the web-bluetooth API.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Indicates the various states of Central.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CentralState =
  | "absent"
  | "powered-off"
  | "powered-on"
  | (string & {})

/**
 * Schema for `CentralState`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CentralState = Schema.String as any as Schema.Codec<CentralState>

/**
 * Indicates the various types of characteristic operation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CharacteristicOperationType =
  | "read"
  | "write"
  | "subscribe-to-notifications"
  | "unsubscribe-from-notifications"
  | (string & {})

/**
 * Schema for `CharacteristicOperationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CharacteristicOperationType = Schema.String as any as Schema.Codec<CharacteristicOperationType>

/**
 * Describes the properties of a characteristic. This follows Bluetooth Core
 * Specification BT 4.2 Vol 3 Part G 3.3.1. Characteristic Properties.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CharacteristicProperties {
  readonly broadcast?: boolean | undefined
  readonly read?: boolean | undefined
  readonly writeWithoutResponse?: boolean | undefined
  readonly write?: boolean | undefined
  readonly notify?: boolean | undefined
  readonly indicate?: boolean | undefined
  readonly authenticatedSignedWrites?: boolean | undefined
  readonly extendedProperties?: boolean | undefined
}

/**
 * Schema for `CharacteristicProperties`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CharacteristicProperties = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    broadcast: Schema.optional(Schema.Boolean),
    read: Schema.optional(Schema.Boolean),
    writeWithoutResponse: Schema.optional(Schema.Boolean),
    write: Schema.optional(Schema.Boolean),
    notify: Schema.optional(Schema.Boolean),
    indicate: Schema.optional(Schema.Boolean),
    authenticatedSignedWrites: Schema.optional(Schema.Boolean),
    extendedProperties: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "BluetoothEmulation.CharacteristicProperties" })
) as any as Schema.Codec<CharacteristicProperties>

/**
 * Indicates the various types of characteristic write.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CharacteristicWriteType =
  | "write-default-deprecated"
  | "write-with-response"
  | "write-without-response"
  | (string & {})

/**
 * Schema for `CharacteristicWriteType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CharacteristicWriteType = Schema.String as any as Schema.Codec<CharacteristicWriteType>

/**
 * Indicates the various types of descriptor operation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DescriptorOperationType =
  | "read"
  | "write"
  | (string & {})

/**
 * Schema for `DescriptorOperationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DescriptorOperationType = Schema.String as any as Schema.Codec<DescriptorOperationType>

/**
 * Indicates the various types of GATT event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type GATTOperationType =
  | "connection"
  | "discovery"
  | (string & {})

/**
 * Schema for `GATTOperationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GATTOperationType = Schema.String as any as Schema.Codec<GATTOperationType>

/**
 * Stores the manufacturer data
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ManufacturerData {
  /**
   * Company identifier
   * https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/company_identifiers/company_identifiers.yaml
   * https://usb.org/developers
   */
  readonly key: number
  /**
   * Manufacturer-specific data (Encoded as a base64 string when passed over JSON)
   */
  readonly data: string
}

/**
 * Schema for `ManufacturerData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ManufacturerData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: Schema.Int,
    data: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.ManufacturerData" })
) as any as Schema.Codec<ManufacturerData>

/**
 * Stores the advertisement packet information that is sent by a Bluetooth device.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScanEntry {
  readonly deviceAddress: string
  readonly rssi: number
  readonly scanRecord: ScanRecord
}

/**
 * Schema for `ScanEntry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScanEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    deviceAddress: Schema.String,
    rssi: Schema.Int,
    scanRecord: ScanRecord
  }).annotate({ identifier: "BluetoothEmulation.ScanEntry" })
) as any as Schema.Codec<ScanEntry>

/**
 * Stores the byte data of the advertisement packet sent by a Bluetooth device.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScanRecord {
  readonly name?: string | undefined
  readonly uuids?: ReadonlyArray<string> | undefined
  /**
   * Stores the external appearance description of the device.
   */
  readonly appearance?: number | undefined
  /**
   * Stores the transmission power of a broadcasting device.
   */
  readonly txPower?: number | undefined
  /**
   * Key is the company identifier and the value is an array of bytes of
   * manufacturer specific data.
   */
  readonly manufacturerData?: ReadonlyArray<ManufacturerData> | undefined
}

/**
 * Schema for `ScanRecord`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScanRecord = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.optional(Schema.String),
    uuids: Schema.optional(Schema.Array(Schema.String)),
    appearance: Schema.optional(Schema.Int),
    txPower: Schema.optional(Schema.Int),
    manufacturerData: Schema.optional(Schema.Array(ManufacturerData))
  }).annotate({ identifier: "BluetoothEmulation.ScanRecord" })
) as any as Schema.Codec<ScanRecord>

/**
 * Adds a characteristic with |characteristicUuid| and |properties| to the
 * service represented by |serviceId|.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddCharacteristicParams {
  readonly serviceId: string
  readonly characteristicUuid: string
  readonly properties: CharacteristicProperties
}

/**
 * Schema for `AddCharacteristicParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddCharacteristicParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    serviceId: Schema.String,
    characteristicUuid: Schema.String,
    properties: CharacteristicProperties
  }).annotate({ identifier: "BluetoothEmulation.AddCharacteristicParams" })
) as any as Schema.Codec<AddCharacteristicParams>

/**
 * Adds a characteristic with |characteristicUuid| and |properties| to the
 * service represented by |serviceId|.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddCharacteristicResult {
  /**
   * An identifier that uniquely represents this characteristic.
   */
  readonly characteristicId: string
}

/**
 * Schema for `AddCharacteristicResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddCharacteristicResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    characteristicId: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.AddCharacteristicResult" })
) as any as Schema.Codec<AddCharacteristicResult>

/**
 * Adds a descriptor with |descriptorUuid| to the characteristic respresented
 * by |characteristicId|.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddDescriptorParams {
  readonly characteristicId: string
  readonly descriptorUuid: string
}

/**
 * Schema for `AddDescriptorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddDescriptorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    characteristicId: Schema.String,
    descriptorUuid: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.AddDescriptorParams" })
) as any as Schema.Codec<AddDescriptorParams>

/**
 * Adds a descriptor with |descriptorUuid| to the characteristic respresented
 * by |characteristicId|.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddDescriptorResult {
  /**
   * An identifier that uniquely represents this descriptor.
   */
  readonly descriptorId: string
}

/**
 * Schema for `AddDescriptorResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddDescriptorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    descriptorId: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.AddDescriptorResult" })
) as any as Schema.Codec<AddDescriptorResult>

/**
 * Adds a service with |serviceUuid| to the peripheral with |address|.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddServiceParams {
  readonly address: string
  readonly serviceUuid: string
}

/**
 * Schema for `AddServiceParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddServiceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    address: Schema.String,
    serviceUuid: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.AddServiceParams" })
) as any as Schema.Codec<AddServiceParams>

/**
 * Adds a service with |serviceUuid| to the peripheral with |address|.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddServiceResult {
  /**
   * An identifier that uniquely represents this service.
   */
  readonly serviceId: string
}

/**
 * Schema for `AddServiceResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddServiceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    serviceId: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.AddServiceResult" })
) as any as Schema.Codec<AddServiceResult>

/**
 * Event for when a characteristic operation of |type| to the characteristic
 * respresented by |characteristicId| happened. |data| and |writeType| is
 * expected to exist when |type| is write.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CharacteristicOperationReceivedParams {
  readonly characteristicId: string
  readonly type: CharacteristicOperationType
  readonly data?: string | undefined
  readonly writeType?: CharacteristicWriteType | undefined
}

/**
 * Schema for `CharacteristicOperationReceivedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CharacteristicOperationReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    characteristicId: Schema.String,
    type: CharacteristicOperationType,
    data: Schema.optional(Schema.String),
    writeType: Schema.optional(CharacteristicWriteType)
  }).annotate({ identifier: "BluetoothEmulation.CharacteristicOperationReceivedParams" })
) as any as Schema.Codec<CharacteristicOperationReceivedParams>

/**
 * Event for when a descriptor operation of |type| to the descriptor
 * respresented by |descriptorId| happened. |data| is expected to exist when
 * |type| is write.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DescriptorOperationReceivedParams {
  readonly descriptorId: string
  readonly type: DescriptorOperationType
  readonly data?: string | undefined
}

/**
 * Schema for `DescriptorOperationReceivedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DescriptorOperationReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    descriptorId: Schema.String,
    type: DescriptorOperationType,
    data: Schema.optional(Schema.String)
  }).annotate({ identifier: "BluetoothEmulation.DescriptorOperationReceivedParams" })
) as any as Schema.Codec<DescriptorOperationReceivedParams>

/**
 * Enable the BluetoothEmulation domain.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * State of the simulated central.
   */
  readonly state: CentralState
  /**
   * If the simulated central supports low-energy.
   */
  readonly leSupported: boolean
}

/**
 * Schema for `EnableParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EnableParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    state: CentralState,
    leSupported: Schema.Boolean
  }).annotate({ identifier: "BluetoothEmulation.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Event for when a GATT operation of |type| to the peripheral with |address|
 * happened.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GattOperationReceivedParams {
  readonly address: string
  readonly type: GATTOperationType
}

/**
 * Schema for `GattOperationReceivedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GattOperationReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    address: Schema.String,
    type: GATTOperationType
  }).annotate({ identifier: "BluetoothEmulation.GattOperationReceivedParams" })
) as any as Schema.Codec<GattOperationReceivedParams>

/**
 * Removes the characteristic respresented by |characteristicId| from the
 * simulated central.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveCharacteristicParams {
  readonly characteristicId: string
}

/**
 * Schema for `RemoveCharacteristicParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveCharacteristicParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    characteristicId: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.RemoveCharacteristicParams" })
) as any as Schema.Codec<RemoveCharacteristicParams>

/**
 * Removes the descriptor with |descriptorId| from the simulated central.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveDescriptorParams {
  readonly descriptorId: string
}

/**
 * Schema for `RemoveDescriptorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveDescriptorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    descriptorId: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.RemoveDescriptorParams" })
) as any as Schema.Codec<RemoveDescriptorParams>

/**
 * Removes the service respresented by |serviceId| from the simulated central.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveServiceParams {
  readonly serviceId: string
}

/**
 * Schema for `RemoveServiceParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveServiceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    serviceId: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.RemoveServiceParams" })
) as any as Schema.Codec<RemoveServiceParams>

/**
 * Set the state of the simulated central.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSimulatedCentralStateParams {
  /**
   * State of the simulated central.
   */
  readonly state: CentralState
}

/**
 * Schema for `SetSimulatedCentralStateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSimulatedCentralStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    state: CentralState
  }).annotate({ identifier: "BluetoothEmulation.SetSimulatedCentralStateParams" })
) as any as Schema.Codec<SetSimulatedCentralStateParams>

/**
 * Simulates an advertisement packet described in |entry| being received by
 * the central.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SimulateAdvertisementParams {
  readonly entry: ScanEntry
}

/**
 * Schema for `SimulateAdvertisementParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SimulateAdvertisementParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    entry: ScanEntry
  }).annotate({ identifier: "BluetoothEmulation.SimulateAdvertisementParams" })
) as any as Schema.Codec<SimulateAdvertisementParams>

/**
 * Simulates the response from the characteristic with |characteristicId| for a
 * characteristic operation of |type|. The |code| value follows the Error
 * Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
 * The |data| is expected to exist when simulating a successful read operation
 * response.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SimulateCharacteristicOperationResponseParams {
  readonly characteristicId: string
  readonly type: CharacteristicOperationType
  readonly code: number
  readonly data?: string | undefined
}

/**
 * Schema for `SimulateCharacteristicOperationResponseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SimulateCharacteristicOperationResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    characteristicId: Schema.String,
    type: CharacteristicOperationType,
    code: Schema.Int,
    data: Schema.optional(Schema.String)
  }).annotate({ identifier: "BluetoothEmulation.SimulateCharacteristicOperationResponseParams" })
) as any as Schema.Codec<SimulateCharacteristicOperationResponseParams>

/**
 * Simulates the response from the descriptor with |descriptorId| for a
 * descriptor operation of |type|. The |code| value follows the Error
 * Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
 * The |data| is expected to exist when simulating a successful read operation
 * response.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SimulateDescriptorOperationResponseParams {
  readonly descriptorId: string
  readonly type: DescriptorOperationType
  readonly code: number
  readonly data?: string | undefined
}

/**
 * Schema for `SimulateDescriptorOperationResponseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SimulateDescriptorOperationResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    descriptorId: Schema.String,
    type: DescriptorOperationType,
    code: Schema.Int,
    data: Schema.optional(Schema.String)
  }).annotate({ identifier: "BluetoothEmulation.SimulateDescriptorOperationResponseParams" })
) as any as Schema.Codec<SimulateDescriptorOperationResponseParams>

/**
 * Simulates a GATT disconnection from the peripheral with |address|.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SimulateGATTDisconnectionParams {
  readonly address: string
}

/**
 * Schema for `SimulateGATTDisconnectionParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SimulateGATTDisconnectionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    address: Schema.String
  }).annotate({ identifier: "BluetoothEmulation.SimulateGATTDisconnectionParams" })
) as any as Schema.Codec<SimulateGATTDisconnectionParams>

/**
 * Simulates the response code from the peripheral with |address| for a
 * GATT operation of |type|. The |code| value follows the HCI Error Codes from
 * Bluetooth Core Specification Vol 2 Part D 1.3 List Of Error Codes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SimulateGATTOperationResponseParams {
  readonly address: string
  readonly type: GATTOperationType
  readonly code: number
}

/**
 * Schema for `SimulateGATTOperationResponseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SimulateGATTOperationResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    address: Schema.String,
    type: GATTOperationType,
    code: Schema.Int
  }).annotate({ identifier: "BluetoothEmulation.SimulateGATTOperationResponseParams" })
) as any as Schema.Codec<SimulateGATTOperationResponseParams>

/**
 * Simulates a peripheral with |address|, |name| and |knownServiceUuids|
 * that has already been connected to the system.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SimulatePreconnectedPeripheralParams {
  readonly address: string
  readonly name: string
  readonly manufacturerData: ReadonlyArray<ManufacturerData>
  readonly knownServiceUuids: ReadonlyArray<string>
}

/**
 * Schema for `SimulatePreconnectedPeripheralParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SimulatePreconnectedPeripheralParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    address: Schema.String,
    name: Schema.String,
    manufacturerData: Schema.Array(ManufacturerData),
    knownServiceUuids: Schema.Array(Schema.String)
  }).annotate({ identifier: "BluetoothEmulation.SimulatePreconnectedPeripheralParams" })
) as any as Schema.Codec<SimulatePreconnectedPeripheralParams>

/**
 * Adds a characteristic with |characteristicUuid| and |properties| to the
 * service represented by |serviceId|.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addCharacteristic: Protocol.CommandDef<
  "BluetoothEmulation.addCharacteristic",
  AddCharacteristicParams,
  AddCharacteristicResult
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.addCharacteristic",
  AddCharacteristicParams,
  AddCharacteristicResult,
  { status: "stable" }
)

/**
 * Adds a descriptor with |descriptorUuid| to the characteristic respresented
 * by |characteristicId|.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addDescriptor: Protocol.CommandDef<
  "BluetoothEmulation.addDescriptor",
  AddDescriptorParams,
  AddDescriptorResult
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.addDescriptor",
  AddDescriptorParams,
  AddDescriptorResult,
  { status: "stable" }
)

/**
 * Adds a service with |serviceUuid| to the peripheral with |address|.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addService: Protocol.CommandDef<"BluetoothEmulation.addService", AddServiceParams, AddServiceResult> =
  /*#__PURE__*/ Protocol.command(
    "BluetoothEmulation.addService",
    AddServiceParams,
    AddServiceResult,
    { status: "stable" }
  )

/**
 * Disable the BluetoothEmulation domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"BluetoothEmulation.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enable the BluetoothEmulation domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"BluetoothEmulation.enable", EnableParams, void> = /*#__PURE__*/ Protocol
  .command(
    "BluetoothEmulation.enable",
    EnableParams,
    undefined,
    { status: "stable" }
  )

/**
 * Removes the characteristic respresented by |characteristicId| from the
 * simulated central.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeCharacteristic: Protocol.CommandDef<
  "BluetoothEmulation.removeCharacteristic",
  RemoveCharacteristicParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.removeCharacteristic",
  RemoveCharacteristicParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes the descriptor with |descriptorId| from the simulated central.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeDescriptor: Protocol.CommandDef<
  "BluetoothEmulation.removeDescriptor",
  RemoveDescriptorParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.removeDescriptor",
  RemoveDescriptorParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes the service respresented by |serviceId| from the simulated central.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeService: Protocol.CommandDef<"BluetoothEmulation.removeService", RemoveServiceParams, void> =
  /*#__PURE__*/ Protocol.command(
    "BluetoothEmulation.removeService",
    RemoveServiceParams,
    undefined,
    { status: "stable" }
  )

/**
 * Set the state of the simulated central.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSimulatedCentralState: Protocol.CommandDef<
  "BluetoothEmulation.setSimulatedCentralState",
  SetSimulatedCentralStateParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.setSimulatedCentralState",
  SetSimulatedCentralStateParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates an advertisement packet described in |entry| being received by
 * the central.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const simulateAdvertisement: Protocol.CommandDef<
  "BluetoothEmulation.simulateAdvertisement",
  SimulateAdvertisementParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.simulateAdvertisement",
  SimulateAdvertisementParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates the response from the characteristic with |characteristicId| for a
 * characteristic operation of |type|. The |code| value follows the Error
 * Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
 * The |data| is expected to exist when simulating a successful read operation
 * response.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const simulateCharacteristicOperationResponse: Protocol.CommandDef<
  "BluetoothEmulation.simulateCharacteristicOperationResponse",
  SimulateCharacteristicOperationResponseParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.simulateCharacteristicOperationResponse",
  SimulateCharacteristicOperationResponseParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates the response from the descriptor with |descriptorId| for a
 * descriptor operation of |type|. The |code| value follows the Error
 * Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
 * The |data| is expected to exist when simulating a successful read operation
 * response.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const simulateDescriptorOperationResponse: Protocol.CommandDef<
  "BluetoothEmulation.simulateDescriptorOperationResponse",
  SimulateDescriptorOperationResponseParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.simulateDescriptorOperationResponse",
  SimulateDescriptorOperationResponseParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates a GATT disconnection from the peripheral with |address|.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const simulateGATTDisconnection: Protocol.CommandDef<
  "BluetoothEmulation.simulateGATTDisconnection",
  SimulateGATTDisconnectionParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.simulateGATTDisconnection",
  SimulateGATTDisconnectionParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates the response code from the peripheral with |address| for a
 * GATT operation of |type|. The |code| value follows the HCI Error Codes from
 * Bluetooth Core Specification Vol 2 Part D 1.3 List Of Error Codes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const simulateGATTOperationResponse: Protocol.CommandDef<
  "BluetoothEmulation.simulateGATTOperationResponse",
  SimulateGATTOperationResponseParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.simulateGATTOperationResponse",
  SimulateGATTOperationResponseParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates a peripheral with |address|, |name| and |knownServiceUuids|
 * that has already been connected to the system.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const simulatePreconnectedPeripheral: Protocol.CommandDef<
  "BluetoothEmulation.simulatePreconnectedPeripheral",
  SimulatePreconnectedPeripheralParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "BluetoothEmulation.simulatePreconnectedPeripheral",
  SimulatePreconnectedPeripheralParams,
  undefined,
  { status: "stable" }
)

/**
 * Event for when a characteristic operation of |type| to the characteristic
 * respresented by |characteristicId| happened. |data| and |writeType| is
 * expected to exist when |type| is write.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const characteristicOperationReceived: Protocol.EventDef<
  "BluetoothEmulation.characteristicOperationReceived",
  CharacteristicOperationReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "BluetoothEmulation.characteristicOperationReceived",
  CharacteristicOperationReceivedParams,
  { status: "stable" }
)

/**
 * Event for when a descriptor operation of |type| to the descriptor
 * respresented by |descriptorId| happened. |data| is expected to exist when
 * |type| is write.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const descriptorOperationReceived: Protocol.EventDef<
  "BluetoothEmulation.descriptorOperationReceived",
  DescriptorOperationReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "BluetoothEmulation.descriptorOperationReceived",
  DescriptorOperationReceivedParams,
  { status: "stable" }
)

/**
 * Event for when a GATT operation of |type| to the peripheral with |address|
 * happened.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const gattOperationReceived: Protocol.EventDef<
  "BluetoothEmulation.gattOperationReceived",
  GattOperationReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "BluetoothEmulation.gattOperationReceived",
  GattOperationReceivedParams,
  { status: "stable" }
)
