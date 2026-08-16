#!/usr/bin/env node

const neurointerface = {};

neurointerface.webBluetoothConnection = (device) => {
  const bytes = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const characteristic = (c) => ({
    read: async () => bytes(await c.readValue()),
    write: (data) => c.writeValueWithResponse(data),
    writeWithoutResponse: (data) => c.writeValueWithoutResponse(data),
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

const THYNC_SERVICE = "3789ff10-16ad-11e4-8c21-0800200c9a66";
const THYNC_DATA = "3789ff11-16ad-11e4-8c21-0800200c9a66";
const SERIAL_NUMBER = "00002a25-0000-1000-8000-00805f9b34fb";
const SOFTWARE_REVISION = "00002a28-0000-1000-8000-00805f9b34fb";
const PUCK = {
  Echo: 0, Led: 1, Trigger: 2, Label: 3, NumDisplay: 4, Shutdown: 5, ErrorDebug: 6, ReadBatteryVoltage: 7, BatteryVoltage: 8,
  ReadButton: 9, Button: 10, HvControl: 11, ReadDeviceName: 12, DeviceName: 13, ReadFirmwareVersion: 14, FirmwareVersion: 15,
  NewWave: 16, WaveSegment: 17, WaveSwap: 18, WaveControl: 19, WaveSave: 20, WaveReserved: 21, ReadSourceVoltage: 22, SourceVoltage: 23,
  ReadImpedance: 24, Impedance: 25, Stm32FirmwarePreamble: 26, Stm32FirmwarePayload: 27, Stm32Restart: 28, WriteDeviceName: 29,
  DownloadStart: 30, DownloadSamples: 31, DownloadFinish: 32, WaveTimerStart: 33, WaveTimerStop: 34, WaveQueueAvailable: 35,
  ResetFromFault: 36, STFirmwareDownloadStart: 37, STAddress: 38, STData: 39, UpdateDone: 40, STUpdateError: 41, ElectrodeDetect: 42,
  ElectrodeType: 43, LED_Pattern: 44, STErase: 50, LED_Flash: 56, ReadSerial: 58, SerialResponse: 59, ReadBatteryDetail: 62,
  BatteryDetailResponse: 63, LEDIntensity: 64, WaveStatus: 76, AMCompact: 78,
};
const PUCK_NAME = Object.fromEntries(Object.entries(PUCK).map(([name, id]) => [id, name]));
const ENDPOINT = { phone: 1, pc: 2, lbm: 4, stm: 8 };
const STM_ERRORS = {
  0x1000: "SEGMENT_TOO_SHORT", 0x1001: "SEGMENT_TOO_LONG", 0x1002: "WAVE_SEGMENT_DEF_MISSING", 0x1003: "UNDEFINED",
  0x1004: "CURRENT_ASKED_OUT_OF_RANGE", 0x1005: "SMARTPHONE_WATCHDOG_TIMEOUT", 0x1006: "DC_LIMITS_FAULT", 0x1007: "NO_WAVE_STRUCT_AVAILABLE",
  0x1008: "TIME_DELAY_SCAN_ASKED_WITHOUT_WAVE", 0x1009: "NB_SEGMENTS_OUT_OF_RANGE", 0x100a: "IMPEDANCE_OUT_OF_RANGE_SHUTDOWN",
  0x100b: "ELECTRODE_DETECT_WHILE_PLAYING", 0x100c: "ELECTRODE_DETECT_FAILED", 0x100d: "CHECK_PAD",
};
const STM_SHUTDOWN_ERRORS = [0x1004, 0x1006, 0x100a, 0x100d];
const ELECTRODE_STATES = ["NOT_CONNECTED", "CALM", "ENERGY", "CALM_HEAD", "ENERGY_HEAD", "HEAD"];

neurointerface.Thync = class Thync {
  constructor(connection) {
    this.connection = connection;
    this.listeners = new Set();
  }

  static matchesName(name) {
    return /thync/i.test(name);
  }

  static async request() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Thync" }, { services: [THYNC_SERVICE] }],
      optionalServices: [THYNC_SERVICE, DEVICE_INFORMATION],
    });
    return new Thync(neurointerface.webBluetoothConnection(device));
  }

  static segments(wave) { return thyncSegments(wave); }

  get name() { return this.connection.name; }

  async connect() {
    await this.connection.connect();
    this.data = await (await this.connection.getService(THYNC_SERVICE)).getCharacteristic(THYNC_DATA);
    this.unsubscribe = await this.data.subscribe((bytes) => {
      const message = decodePuck(bytes);
      for (const listener of this.listeners) listener(message);
    });
  }

  async disconnect() {
    await this.unsubscribe?.();
    this.unsubscribe = null;
    await this.connection.disconnect();
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(id, destination, payload = []) {
    return this.data.write(encodePuck(id, ENDPOINT.phone, destination, payload));
  }

  async request(id, destination, payload, matches, timeout = 5000) {
    let settle;
    const reply = new Promise((resolve) => { settle = resolve; });
    const off = this.onMessage((message) => { if (matches(message)) settle(message); });
    const timer = setTimeout(() => settle(null), timeout);
    try {
      await this.send(id, destination, payload);
      return await reply;
    } finally {
      clearTimeout(timer);
      off();
    }
  }

  resetFromFault() { return this.send(PUCK.ResetFromFault, ENDPOINT.stm); }
  keepAlive() { return this.send(PUCK.ReadBatteryDetail, ENDPOINT.lbm); }

  async readDeviceInfo() {
    const text = async (uuid) => {
      try { return payloadText(await (await (await this.connection.getService(DEVICE_INFORMATION)).getCharacteristic(uuid)).read()); }
      catch { return undefined; }
    };
    const firmware = async (source) =>
      payloadText((await this.request(PUCK.ReadFirmwareVersion, source, [], (m) => m.id === PUCK.FirmwareVersion && m.source === source))?.payload);
    return {
      deviceName: payloadText((await this.request(PUCK.ReadDeviceName, ENDPOINT.lbm, [], (m) => m.id === PUCK.DeviceName))?.payload),
      serial: await text(SERIAL_NUMBER),
      hardware: await text(HARDWARE_REVISION),
      firmware: await text(FIRMWARE_REVISION),
      software: await text(SOFTWARE_REVISION),
      firmwareLbm: await firmware(ENDPOINT.lbm),
      firmwareStm: await firmware(ENDPOINT.stm),
    };
  }

  async readBattery() {
    const message = await this.request(PUCK.ReadBatteryDetail, ENDPOINT.lbm, [], (m) => m.id === PUCK.BatteryDetailResponse);
    return message && decodeBatteryDetail(message.payload);
  }

  async readImpedance() {
    const message = await this.request(PUCK.ReadImpedance, ENDPOINT.stm, [], (m) => m.id === PUCK.Impedance);
    return message && decodeImpedance(message.payload);
  }

  async detectElectrode() {
    const message = await this.request(PUCK.ElectrodeDetect, ENDPOINT.stm, [], (m) => m.id === PUCK.ElectrodeType);
    return message && decodeElectrode(message.payload);
  }

  ledPattern(pattern) { return this.send(PUCK.LED_Pattern, ENDPOINT.lbm, [pattern & 0xff]); }
  ledIntensity(level) { return this.send(PUCK.LEDIntensity, ENDPOINT.lbm, [level & 0xff]); }
  ledFlash(on) { return this.send(PUCK.LED_Flash, ENDPOINT.lbm, [on ? 0 : 1]); }
  shutdown() { return this.send(PUCK.Shutdown, ENDPOINT.lbm); }

  async startWave(wave, fresh = true) {
    const segments = thyncSegments(wave);
    await this.send(PUCK.NewWave, ENDPOINT.stm, [fresh ? 0 : 1, fresh ? segments.length : 0, 0, 0]);
    for (const [index, { duration, current, state }] of segments.entries()) {
      await this.send(PUCK.WaveSegment, ENDPOINT.stm, [index, duration & 0xff, (duration >> 8) & 0xff, (duration >> 16) & 0xff, current & 0xff, (current >> 8) & 0xff, state]);
    }
    await this.send(PUCK.WaveControl, ENDPOINT.stm, [2, 0, 0]);
  }

  stopWave() { return this.send(PUCK.WaveControl, ENDPOINT.stm, [0, 0, 0]); }
};

function encodePuck(id, source, destination, payload) {
  return Uint8Array.of(id & 0xff, ((destination << 4) | (source & 0x0f)) & 0xff, ...payload);
}

function decodePuck(bytes) {
  const id = bytes[0];
  if (id === PUCK.ErrorDebug) {
    const code = bytes.length >= 4 ? (bytes[bytes.length - 1] << 8) | bytes[bytes.length - 2] : undefined;
    return { id, name: "ErrorDebug", code, error: STM_ERRORS[code] ?? (code === undefined ? "UNKNOWN" : `0x${code.toString(16)}`), fatal: STM_SHUTDOWN_ERRORS.includes(code), payload: bytes.subarray(1) };
  }
  const header = bytes[1] ?? 0;
  return { id, name: PUCK_NAME[id] ?? `0x${id.toString(16)}`, destination: header >> 4, source: header & 0x0f, payload: bytes.subarray(2) };
}

function payloadText(bytes) {
  return bytes && String.fromCharCode(...bytes.filter((byte) => byte));
}

function decodeBatteryDetail(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const u16 = (offset) => payload.length >= offset + 2 ? view.getUint16(offset, true) : undefined;
  return { percent: payload[4], millivolts: u16(2), remainingMah: u16(0), milliamps: payload.length >= 8 ? view.getInt16(6, true) : undefined };
}

function decodeImpedance(payload) {
  return payload.length >= 2 ? (payload[0] << 8) | payload[1] : undefined;
}

function decodeElectrode(payload) {
  return payload.length ? ELECTRODE_STATES[payload[0]] ?? `0x${payload[0].toString(16)}` : undefined;
}

const PULSE_A = 3, PULSE_B = 48, OPEN = 0, SHORT = 85, TIMER_HZ = 12000000, DURATION_MASK = 0xffffff;
const clampDuration = (value) => Math.max(Math.min(Math.trunc(value), DURATION_MASK), 0);
const waveState = (directionA, shortCircuit, energy, length) => (energy << 4) | (shortCircuit << 5) | (directionA << 6) | length;
const WAVE_STATES = {
  [waveState(1, 0, 0, 4)]: [PULSE_A, OPEN, PULSE_B, OPEN], [waveState(1, 1, 0, 4)]: [PULSE_A, SHORT, PULSE_B, SHORT],
  [waveState(0, 0, 0, 4)]: [PULSE_B, OPEN, PULSE_A, OPEN], [waveState(0, 1, 0, 4)]: [PULSE_B, SHORT, PULSE_A, SHORT],
  [waveState(1, 0, 0, 2)]: [PULSE_A, OPEN], [waveState(1, 1, 0, 2)]: [PULSE_A, SHORT],
  [waveState(0, 0, 0, 2)]: [PULSE_B, OPEN], [waveState(0, 1, 0, 2)]: [PULSE_B, SHORT],
  [waveState(1, 0, 1, 3)]: [PULSE_A, SHORT, OPEN], [waveState(1, 1, 1, 3)]: [PULSE_A, SHORT, SHORT],
  [waveState(0, 0, 1, 3)]: [PULSE_B, SHORT, OPEN], [waveState(0, 1, 1, 3)]: [PULSE_B, SHORT, SHORT],
  [waveState(1, 0, 1, 5)]: [PULSE_A, OPEN, SHORT, PULSE_B, OPEN], [waveState(1, 1, 1, 5)]: [PULSE_A, SHORT, SHORT, PULSE_B, SHORT],
  [waveState(0, 0, 1, 5)]: [PULSE_B, OPEN, SHORT, PULSE_A, OPEN], [waveState(0, 1, 1, 5)]: [PULSE_B, SHORT, SHORT, PULSE_A, SHORT],
};

function thyncSegments({ current, frequency = 9699, duty = 50, dc = 0, direction = "a", shortCircuit = false, energy = false }) {
  const dutyFraction = 0.01 * duty, dcFraction = 0.01 * dc;
  const duration1 = clampDuration((1 - dutyFraction) * TIMER_HZ / (2 * frequency));
  const half = (1 - dcFraction) * dutyFraction * TIMER_HZ / (2 * frequency);
  const full = Math.trunc(dutyFraction * TIMER_HZ / frequency);
  const current0 = Math.trunc(current * 256) & 0xffff;
  let durations, currents;
  if (!energy) {
    const duration2 = clampDuration(half);
    durations = [full - duration2, duration1, duration2, clampDuration(duration1)];
    currents = [current0, 0, current0, 0];
  } else {
    const duration3 = clampDuration(half);
    durations = [clampDuration(full - duration3), duration1, 60, clampDuration(duration3 - 60), clampDuration(duration1)];
    currents = [current0, 0, 0, current0, 0];
  }
  const states = WAVE_STATES[waveState(direction === "a" ? 1 : 0, shortCircuit ? 1 : 0, energy ? 1 : 0, durations.length)];
  if (!states) throw new Error("no wave state table for these parameters");
  const segments = durations.map((duration, i) => ({ duration, state: states[i], current: currents[i], tooShort: 0 }));
  return energy && !(frequency > 2000) ? correctEnergySegments(segments) : correctShortSegments(segments);
}

function classifySegments(segments) {
  const pulse = [], idle = [];
  for (const segment of segments) {
    if (segment.duration < 36) segment.tooShort = 36 - segment.duration;
    (segment.state === PULSE_A || segment.state === PULSE_B ? pulse : idle).push(segment);
  }
  return { pulse, idle };
}

function correctShortSegments(segments) {
  const { pulse: [p1, p2], idle: [v1, v2, v3] } = classifySegments(segments);
  if (p1 && Math.max(p2?.duration ?? 0, p1.duration) === p1.duration) {
    if (p1.duration < 84) p1.duration = 84;
    if (p2 && p2.duration < 36) p2.duration = 36;
  } else {
    if (p2 && p2.duration < 84) p2.duration = 84;
    if (p1 && p1.duration < 36) p1.duration = 36;
  }
  if (v1 && v1.tooShort > 0) v1.duration = 36;
  if (v2 && v2.tooShort > 0) { v1.duration = 36; v2.duration = v1.duration; }
  if (v3 && v3.tooShort > 0) { v1.duration = 36; v3.duration = v1.duration; }
  return segments;
}

function correctEnergySegments(segments) {
  const { pulse: [, p2] } = classifySegments(segments);
  if (segments.length === 5 && p2) {
    const index = segments.indexOf(p2);
    segments[index - 1] = { duration: 132, state: PULSE_B, current: roundHalfEven(p2.current * 1.9) & 0xffff, tooShort: 0 };
  }
  return segments;
}

const roundHalfEven = (value) => { const rounded = Math.round(value); return Math.abs(value % 1) === 0.5 && rounded % 2 ? rounded - 1 : rounded; };

const NEO_SERVICE = "14b70001-c2e6-11e8-a355-529269fb1459";
const NEO_DATA = "14b70002-c2e6-11e8-a355-529269fb1459";
const NEO = { PROGRAM: 0x00, START: 0x02, BATTERY_REQ: 0x03, INFO_REQ: 0x07, PROGRAM_IN_PROGRESS: 0x17, START_STOP: 0x1a };
const NEO_CUSTOM_PROGRAM = 0x0a;
const NEO_FREQUENCIES = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "5.5": 6, "6": 7, "7.83": 8, "8": 9, "9": 10, "10": 11, "12": 12, "14": 13, "15": 14, "16.28": 15, "20": 16, "20.98": 17, "23": 18, "30": 19, "32.23": 20, "34": 21, "40": 22, "44": 23, "50.57": 24 };
const NEO_POWERS = { "0.1": 0x40, "0.25": 0x30, "0.5": 0x20, "2.5": 0x10, "10": 0x50, "25": 0x60, "50": 0x70, "128": 0x80 };
const NEO_COILS = { front: 1, left_right: 2, all: 3, main: 4, external: 5 };
const NEO_PROGRAMS = { schumann: "7.83", delta: "3", theta: "6", alpha: "10", beta: "15", gamma: "40" };

neurointerface.NeoRhythm = class NeoRhythm {
  constructor(connection) {
    this.connection = connection;
    this.listeners = new Set();
  }

  static matchesName(name) {
    return /neorhythm/i.test(name);
  }

  static async request() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "NeoRhythm" }, { services: [NEO_SERVICE] }],
      optionalServices: [NEO_SERVICE],
    });
    return new NeoRhythm(neurointerface.webBluetoothConnection(device));
  }

  static program(options) { return neoProgramFrame(options); }

  get name() { return this.connection.name; }

  async connect() {
    await this.connection.connect();
    this.data = await (await this.connection.getService(NEO_SERVICE)).getCharacteristic(NEO_DATA);
    try {
      this.unsubscribe = await this.data.subscribe((bytes) => {
        const message = decodeNeo(bytes);
        for (const listener of this.listeners) listener(message);
      });
    } catch { this.unsubscribe = null; }
  }

  async disconnect() {
    await this.unsubscribe?.();
    this.unsubscribe = null;
    await this.connection.disconnect();
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(bytes) { return this.data.writeWithoutResponse(Uint8Array.from(bytes)); }

  program(options) { return this.send(neoProgramFrame(options)); }
  start() { return this.send([NEO.START_STOP, 1]); }
  stop() { return this.send([NEO.START_STOP, 0]); }
  requestBattery() { return this.send([NEO.BATTERY_REQ]); }
  requestInfo() { return this.send([NEO.INFO_REQ]); }
};

function neoProgramFrame({ program, frequency, power = "10", coils = "all", minutes = 20 }) {
  const label = frequency ?? NEO_PROGRAMS[program];
  const frequencyByte = NEO_FREQUENCIES[label];
  if (frequencyByte === undefined) throw new Error(`unknown NeoRhythm frequency "${program ?? frequency}"`);
  if (NEO_POWERS[power] === undefined) throw new Error(`unknown NeoRhythm power "${power}"`);
  if (NEO_COILS[coils] === undefined) throw new Error(`unknown NeoRhythm coils "${coils}"`);
  const duration = Math.max(0, Math.min(0xffff, Math.round(minutes)));
  return [NEO.PROGRAM, NEO_CUSTOM_PROGRAM, NEO_POWERS[power] | NEO_COILS[coils], frequencyByte, (duration >> 8) & 0xff, duration & 0xff];
}

const NEO_NAME = Object.fromEntries(Object.entries(NEO).map(([name, type]) => [type, name]));
function decodeNeo(bytes) {
  const type = bytes[0];
  return { type, name: NEO_NAME[type] ?? `0x${type.toString(16)}`, payload: bytes.subarray(1) };
}

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
    writeWithoutResponse: (data) => c.writeAsync(Buffer.from(data), true),
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
  "  neurointerface write --device thync --program calm|energy [--current <mA>] [--minutes <n>] [--target <id|address|name>]",
  "  neurointerface write --device neorhythm --program schumann|delta|theta|alpha|beta|gamma [--power <mT>] [--coils <zone>] [--minutes <n>] [--target <id|address|name>]",
].join("\n");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startNoble() {
  const noble = (await import("@stoprocent/noble")).default;
  await noble.waitForPoweredOnAsync();
  return noble;
}

async function scan() {
  const noble = await startNoble();
  noble.on("discover", (peripheral) => console.log(describe(peripheral)));
  await noble.startScanningAsync([], false);
  await sleep(SCAN_MS);
  await noble.stopScanningAsync();
  noble.stop();
}

async function connectTo(Device, target) {
  const noble = await startNoble();
  const peripheral = await findPeripheral(noble, (candidate) => target
    ? [candidate.id, candidate.address, candidate.advertisement.localName].includes(target)
    : Device.matchesName(candidate.advertisement.localName));
  const device = new Device(neurointerface.nobleConnection(peripheral));
  await device.connect();
  console.error(describe(peripheral));
  return { noble, device };
}

async function readMendi(target) {
  const { noble, device: mendi } = await connectTo(neurointerface.Mendi, target);
  console.error(JSON.stringify(await mendi.readDeviceInfo()));
  console.error(JSON.stringify(await mendi.readBattery()));
  const unsubscribe = await mendi.subscribeFrames((frame) => console.log(JSON.stringify(frame)));
  await new Promise((resolve) => process.once("SIGINT", resolve));
  await unsubscribe();
  await mendi.disconnect();
  noble.stop();
}

async function readThync(target) {
  const { noble, device: thync } = await connectTo(neurointerface.Thync, target);
  await thync.resetFromFault();
  console.error(JSON.stringify(await thync.readDeviceInfo()));
  thync.onMessage((message) => { if (message.error) console.log(JSON.stringify({ error: message.error })); });
  let stop = false;
  process.once("SIGINT", () => { stop = true; });
  for (let tick = 0; !stop; tick++) {
    const electrode = await thync.detectElectrode();
    console.log(JSON.stringify(tick % 2 ? { electrode, impedance: await thync.readImpedance() } : { electrode, battery: await thync.readBattery() }));
    await sleep(1250);
  }
  await thync.disconnect();
  noble.stop();
}

async function writeThync({ program, current = "1", minutes = "1", target }) {
  if (program !== "calm" && program !== "energy") throw new Error(`write: --program must be calm or energy\n${USAGE}`);
  current = Number(current); minutes = Number(minutes);
  if (!(current > 0 && current <= 3)) throw new Error("write: --current must be between 0 and 3 mA");
  if (!(minutes > 0)) throw new Error("write: --minutes must be positive");
  const { noble, device: thync } = await connectTo(neurointerface.Thync, target);
  await thync.resetFromFault();
  console.error(JSON.stringify(await thync.readDeviceInfo()));
  let stop = false, fault = false;
  thync.onMessage((message) => {
    if (!message.error) return;
    console.error(`device error: ${message.error}`);
    if (message.fatal) stop = fault = true;
  });
  process.once("SIGINT", () => { stop = true; });
  const steps = 5, ramp = 2000, wave = { energy: program === "energy" };
  console.error(`${program}: ramping up to ${current} mA`);
  for (let step = 1; step <= steps && !stop; step++) {
    await thync.startWave({ ...wave, current: current * step / steps }, step === 1);
    await thync.keepAlive();
    await sleep(ramp / steps);
  }
  console.error(`holding ${current} mA for ${minutes} min (Ctrl-C to stop early)`);
  const end = Date.now() + minutes * 60000;
  let refreshed = Date.now();
  while (Date.now() < end && !stop) {
    const battery = await thync.readBattery();
    if (battery) console.log(JSON.stringify({ battery }));
    if (Date.now() - refreshed >= 5000 && !stop) { await thync.startWave({ ...wave, current }, false); refreshed = Date.now(); }
    await sleep(1250);
  }
  if (!fault) {
    console.error("ramping down");
    for (let step = steps - 1; step > 0; step--) {
      await thync.startWave({ ...wave, current: current * step / steps }, false);
      await sleep(ramp / steps);
    }
  }
  await thync.stopWave();
  console.error(fault ? "stopped after a device fault" : "stopped");
  await thync.disconnect();
  noble.stop();
}


async function writeNeoRhythm({ program, power = "10", coils = "all", minutes = "20", target }) {
  const frame = neurointerface.NeoRhythm.program({ program, power, coils, minutes: Number(minutes) });
  if (!(Number(minutes) > 0)) throw new Error("write: --minutes must be positive");
  const { noble, device: neo } = await connectTo(neurointerface.NeoRhythm, target);
  neo.onMessage((m) => console.log(JSON.stringify({ message: m.name })));
  await neo.program({ program, power, coils, minutes: Number(minutes) });
  await neo.start();
  console.error(`neorhythm: ${program} · ${power} mT · ${coils} coils · ${minutes} min (Ctrl-C to stop)`);
  const timer = setTimeout(() => process.emit("SIGINT"), Number(minutes) * 60000);
  await new Promise((resolve) => process.once("SIGINT", resolve));
  clearTimeout(timer);
  await neo.stop();
  console.error("stopped");
  await neo.disconnect();
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
    else if (["--device", "--target", "--program", "--current", "--minutes", "--power", "--coils"].includes(arg)) options[arg.slice(2)] = args.shift();
    else if (arg.startsWith("-")) throw new Error(`unknown option "${arg}"\n${USAGE}`);
    else positionals.push(arg);
  }
  const [command] = positionals, device = options.device?.toLowerCase();
  if (options.help || !command) console.log(USAGE);
  else if (command === "scan") await scan();
  else if (command !== "read" && command !== "write") throw new Error(`unknown command "${command}"\n${USAGE}`);
  else if (!device) throw new Error(`${command}: --device is required\n${USAGE}`);
  else if (command === "read" && device === "mendi") await readMendi(options.target);
  else if (command === "read" && device === "thync") await readThync(options.target);
  else if (command === "write" && device === "thync") await writeThync(options);
  else if (command === "write" && device === "neorhythm") await writeNeoRhythm(options);
  else throw new Error(`${command}: unsupported device "${options.device}"`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
