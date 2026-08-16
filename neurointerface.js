#!/usr/bin/env node

const neurointerface = {};

neurointerface.webBluetoothConnection = (device) => {
  const bytes = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const characteristic = (c) => ({
    read: async () => bytes(await c.readValue()),
    write: (data) => c.writeValueWithResponse(data),
    subscribe: async (listener) => {
      const onChange = (event) => listener(bytes(event.target.value));
      c.addEventListener("characteristicvaluechanged", onChange);
      await c.startNotifications();
      return async () => {
        c.removeEventListener("characteristicvaluechanged", onChange);
        await c.stopNotifications();
      };
    },
  });
  const service = (s) => ({
    getCharacteristic: async (uuid) => characteristic(await s.getCharacteristic(uuid)),
  });
  return {
    name: device.name,
    connect: () => device.gatt.connect(),
    disconnect: async () => device.gatt.disconnect(),
    getService: async (uuid) => service(await device.gatt.getPrimaryService(uuid)),
  };
};

const MENDI_SERVICE = "fc3eabb0-c6c4-49e6-922a-6e551c455af5";
const MENDI_FRAME = "fc3eabb1-c6c4-49e6-922a-6e551c455af5";
const MENDI_BATTERY = "fc3eabb4-c6c4-49e6-922a-6e551c455af5";
const MENDI_DIAGNOSTIC = "fc3eabb5-c6c4-49e6-922a-6e551c455af5";
const MENDI_CALIBRATION = "fc3eabb6-c6c4-49e6-922a-6e551c455af5";
const DEVICE_INFORMATION = "0000180a-0000-1000-8000-00805f9b34fb";
const MANUFACTURER_NAME = "00002a29-0000-1000-8000-00805f9b34fb";
const HARDWARE_REVISION = "00002a27-0000-1000-8000-00805f9b34fb";
const FIRMWARE_REVISION = "00002a26-0000-1000-8000-00805f9b34fb";
const FRAME_FIELDS = ["accX", "accY", "accZ", "angX", "angY", "angZ", "temp", "irL", "irR", "irP", "redL", "redR", "redP", "ambL", "ambR", "ambP"];

neurointerface.Mendi = class Mendi {
  constructor(connection) {
    this.connection = connection;
  }

  static matchesName(name) {
    return /mendi/i.test(name);
  }

  static async request() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Mendi" }, { services: [MENDI_SERVICE] }],
      optionalServices: [MENDI_SERVICE, DEVICE_INFORMATION],
    });
    return new Mendi(neurointerface.webBluetoothConnection(device));
  }

  get name() { return this.connection.name; }
  connect() { return this.connection.connect(); }
  disconnect() { return this.connection.disconnect(); }

  async readDeviceInfo() {
    const text = (uuid) => this.#read(uuid, (bytes) => new TextDecoder().decode(bytes), DEVICE_INFORMATION);
    return {
      manufacturer: await text(MANUFACTURER_NAME),
      hardwareRevision: await text(HARDWARE_REVISION),
      firmwareRevision: await text(FIRMWARE_REVISION),
    };
  }

  readFrame() { return this.#read(MENDI_FRAME, decodeFrame); }
  subscribeFrames(listener) { return this.#subscribe(MENDI_FRAME, decodeFrame, listener); }
  readBattery() { return this.#read(MENDI_BATTERY, decodeBattery); }
  subscribeBattery(listener) { return this.#subscribe(MENDI_BATTERY, decodeBattery, listener); }
  subscribeDiagnostic(listener) { return this.#subscribe(MENDI_DIAGNOSTIC, decodeDiagnostic, listener); }
  readCalibration() { return this.#read(MENDI_CALIBRATION, decodeCalibration); }

  async #characteristic(uuid, service = MENDI_SERVICE) {
    return (await this.connection.getService(service)).getCharacteristic(uuid);
  }

  async #read(uuid, decode, service) {
    return decode(await (await this.#characteristic(uuid, service)).read());
  }

  async #subscribe(uuid, decode, listener) {
    return (await this.#characteristic(uuid)).subscribe((bytes) => listener(decode(bytes)));
  }
};

function decodeFrame(bytes) {
  const fields = decodeProtobuf(bytes);
  return Object.fromEntries(FRAME_FIELDS.map((name, i) => [name, fields[i + 1] | 0]));
}

function decodeBattery(bytes) {
  const fields = decodeProtobuf(bytes);
  return { millivolts: fields[1] ?? 0, charging: fields[2] ?? 0, usb: fields[3] ?? 0 };
}

function decodeDiagnostic(bytes) {
  const fields = decodeProtobuf(bytes);
  return { adc: fields[1] && decodeBattery(fields[1]), imuOk: fields[2] ?? 0, sensorOk: fields[3] ?? 0 };
}

function decodeCalibration(bytes) {
  const fields = decodeProtobuf(bytes);
  return { offsets: [fields[1] | 0, fields[2] | 0, fields[3] | 0], en: fields[4] ?? 0, lp: fields[5] ?? 0 };
}

function decodeProtobuf(bytes) {
  const fields = {};
  let pos = 0;
  const varint = () => {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes[pos++];
      if (shift < 32) value = (value | ((byte & 0x7f) << shift)) >>> 0;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  while (pos < bytes.length) {
    const tag = varint(), field = tag >>> 3, wire = tag & 7;
    if (wire === 0) fields[field] = varint();
    else if (wire === 2) { const length = varint(); fields[field] = bytes.subarray(pos, pos += length); }
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else break;
  }
  return fields;
}

// ---- Node only from here on; index.html carries a verbatim copy of everything above (minus the shebang) ----

const bareUuid = (uuid) => uuid.toLowerCase().replace(/-/g, "").replace(/^0000(.{4})00001000800000805f9b34fb$/, "$1");

function findUuid(items, uuid) {
  const item = items.find((candidate) => bareUuid(candidate.uuid) === bareUuid(uuid));
  if (!item) throw new Error(`${uuid} not found`);
  return item;
}

neurointerface.nobleConnection = (peripheral) => {
  const characteristic = (c) => ({
    uuid: c.uuid,
    read: async () => new Uint8Array(await c.readAsync()),
    write: (data) => c.writeAsync(Buffer.from(data), false),
    subscribe: async (listener) => {
      const onData = (buffer) => listener(new Uint8Array(buffer));
      c.on("data", onData);
      await c.subscribeAsync();
      return async () => {
        c.removeListener("data", onData);
        await c.unsubscribeAsync();
      };
    },
  });
  const service = (s) => {
    let characteristics;
    return {
      uuid: s.uuid,
      getCharacteristic: async (uuid) =>
        findUuid(await (characteristics ??= s.discoverCharacteristicsAsync().then((list) => list.map(characteristic))), uuid),
    };
  };
  let services;
  return {
    name: peripheral.advertisement.localName,
    connect: async () => { services = undefined; await peripheral.connectAsync(); },
    disconnect: () => peripheral.disconnectAsync(),
    getService: async (uuid) =>
      findUuid(await (services ??= peripheral.discoverServicesAsync().then((list) => list.map(service))), uuid),
  };
};

const SCAN_MS = 5000;
const USAGE = [
  "Usage:",
  "  neurointerface scan",
  "  neurointerface read --device mendi [--target <id|address|name>]",
].join("\n");

async function startNoble() {
  const noble = (await import("@stoprocent/noble")).default;
  await noble.waitForPoweredOnAsync();
  return noble;
}

async function scan() {
  const noble = await startNoble();
  noble.on("discover", (peripheral) => console.log(describe(peripheral)));
  await noble.startScanningAsync([], false);
  await new Promise((resolve) => setTimeout(resolve, SCAN_MS));
  await noble.stopScanningAsync();
  noble.stop();
}

async function readMendi(target) {
  const noble = await startNoble();
  const peripheral = await findPeripheral(noble, (candidate) => target
    ? [candidate.id, candidate.address, candidate.advertisement.localName].includes(target)
    : neurointerface.Mendi.matchesName(candidate.advertisement.localName));
  const mendi = new neurointerface.Mendi(neurointerface.nobleConnection(peripheral));
  await mendi.connect();
  console.error(describe(peripheral));
  console.error(JSON.stringify(await mendi.readDeviceInfo()));
  console.error(JSON.stringify(await mendi.readBattery()));
  const unsubscribe = await mendi.subscribeFrames((frame) => console.log(JSON.stringify(frame)));
  await new Promise((resolve) => process.once("SIGINT", resolve));
  await unsubscribe();
  await mendi.disconnect();
  noble.stop();
}

function describe({ id, address, rssi, advertisement: { localName } }) {
  return `${localName ?? "(no name)"}  id=${id}${address ? `  address=${address}` : ""}  rssi=${rssi}`;
}

async function findPeripheral(noble, matches) {
  const peripheral = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no matching peripheral found")), SCAN_MS);
    noble.on("discover", (candidate) => {
      if (matches(candidate)) {
        clearTimeout(timer);
        resolve(candidate);
      }
    });
    noble.startScanningAsync([], false).catch(reject);
  });
  await noble.stopScanningAsync();
  return peripheral;
}

try {
  const args = process.argv.slice(2), options = {}, positionals = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--device" || arg === "--target") options[arg.slice(2)] = args.shift();
    else if (arg.startsWith("-")) throw new Error(`unknown option "${arg}"\n${USAGE}`);
    else positionals.push(arg);
  }
  const [command] = positionals;
  if (options.help || !command) console.log(USAGE);
  else if (command === "scan") await scan();
  else if (command !== "read") throw new Error(`unknown command "${command}"\n${USAGE}`);
  else if (!options.device) throw new Error(`read: --device is required\n${USAGE}`);
  else if (options.device.toLowerCase() !== "mendi") throw new Error(`read: unsupported device "${options.device}" (only mendi is implemented)`);
  else await readMendi(options.target);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
