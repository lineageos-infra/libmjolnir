<script setup lang="ts">
  import { ref } from 'vue';
  import libmjolnir, { OdinDevice, libpit } from 'libmjolnir';
  import { version as libmjolnirVersion } from 'libmjolnir/package.json';

  import PartitionEntry from './components/PartitionEntry.vue';

  const devicePit = ref<libpit.PitData>();
  const connectedDevice = ref<OdinDevice>();
  const lz4Supported = ref(false);

  const verboseLogging = ref(true);
  const defaultTimeout = ref(15000);
  const resetOnInit = ref(false);

  async function readPit (device: OdinDevice) {
    await device.beginSession();
    lz4Supported.value = device.lz4Supported;
    devicePit.value = await device.getPitData();
    await device.endSession();
  }

  async function setupDevice (device: OdinDevice) {
    console.log(device.usbDevice);
    await device.initialize();

    connectedDevice.value = device;

    device.onDisconnect(() => {
      connectedDevice.value = undefined;
      devicePit.value = undefined;
      console.log('device was disconnected')
    });

    await readPit(device);
  }

  function deviceOptions () {
    return {
      logging: verboseLogging.value,
      timeout: defaultTimeout.value,
      resetOnInit: resetOnInit.value
    };
  }

  function requestDeviceAccess () {
    libmjolnir.requestDevice(deviceOptions()).then(setupDevice);
  }

  function requestSerialDeviceAccess () {
    libmjolnir.requestSerialDevice(deviceOptions()).then(setupDevice);
  }

  function refreshPit () {
    if (connectedDevice.value) {
      readPit(connectedDevice.value);
    }
  }

  function rebootDevice () {
    connectedDevice.value?.reboot();
  }

  async function flashPartition (data: {name: string, data: Blob}) {
    await connectedDevice.value?.flashPartition(data.name, data.data);
  }

  const pitFile = ref<File>();

  function stagePitFile (event: Event) {
    pitFile.value = (event.target as HTMLInputElement).files?.[0];
  }

  async function flashPit () {
    if (!connectedDevice.value || !pitFile.value) {
      return;
    }

    await connectedDevice.value.flashPit(pitFile.value);
    await readPit(connectedDevice.value);
  }
</script>

<template>
  <header>
    <h1>libmjolnir example</h1>
    <p>libmjolnir version: {{ libmjolnirVersion }}</p>
  </header>
  <fieldset class="connection-options">
    <legend>Connection options</legend>
    <div>
      <label>Verbose logging: </label>
      <input type="checkbox" v-model="verboseLogging" />
    </div>
    <div>
      <label>Packet timeout: </label>
      <input type="number" v-model="defaultTimeout" />
    </div>
    <div>
      <label>Reset on initialize: </label>
      <input type="checkbox" v-model="resetOnInit" />
    </div>
  </fieldset>
  <div class="connect-buttons">
    <button @click="requestDeviceAccess">Request device access (WebUSB)</button>
    <button @click="requestSerialDeviceAccess">Request device access (Web Serial)</button>
  </div>
  <section v-if="connectedDevice && devicePit?.entries?.length">
    <div class="device-info">
      <span>board type: {{ devicePit.boardType }}</span>
      <span class="badge" :class="{ supported: lz4Supported }">
        {{ lz4Supported ? 'LZ4 supported' : 'LZ4 not supported' }}
      </span>
      <button @click="rebootDevice">Reboot device</button>
      <button @click="refreshPit">Refresh PIT</button>
    </div>
    <div class="flash-pit">
      <label>Flash PIT: </label>
      <input type="file" accept=".pit" @change="stagePitFile" />
      <button :disabled="!pitFile" @click="flashPit">Flash PIT</button>
    </div>
    <p class="hint">
      .lz4 files are flashed compressed when the device supports it, and decompressed on the host
      otherwise.
    </p>
    <table class="pit-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Partition</th>
          <th>Flash filename</th>
          <th>Device</th>
          <th>Binary</th>
          <th>Block size/offset</th>
          <th>Flash</th>
        </tr>
      </thead>
      <tbody>
        <partition-entry
          v-for="entry in devicePit.entries"
          :key="entry.identifier"
          :entry="entry"
          @flash="flashPartition"
        />
      </tbody>
    </table>
  </section>
</template>

<style>
  :root {
    color-scheme: light dark;
    --border: color-mix(in srgb, currentColor 20%, transparent);
    --surface: color-mix(in srgb, currentColor 7%, transparent);
  }

  body {
    font-family: system-ui, sans-serif;
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.5rem;
    line-height: 1.5;
  }

  h1 {
    font-size: 1.5rem;
    margin-bottom: 0.25rem;
  }

  button,
  input[type='file']::file-selector-button {
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background-color: var(--surface);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }

  button:enabled:hover,
  input[type='file']::file-selector-button:hover {
    background-color: color-mix(in srgb, currentColor 14%, transparent);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input[type='number'] {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    font: inherit;
    font-size: 0.9rem;
  }

  input[type='file'] {
    font-size: 0.85rem;
  }

  input[type='file']::file-selector-button {
    margin-right: 0.625rem;
  }

  .connect-buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .connection-options {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    width: fit-content;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .device-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 2rem;
  }

  .badge {
    border-radius: 1rem;
    padding: 0.15rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 500;
    background-color: var(--surface);
    opacity: 0.8;
  }

  .badge.supported {
    color: light-dark(#15803d, #4ade80);
    background-color: color-mix(in srgb, currentColor 12%, transparent);
    opacity: 1;
  }

  .flash-pit {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .hint {
    font-size: 0.85rem;
    opacity: 0.6;
    margin: 0.5rem 0 1rem;
  }

  .pit-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
  }

  .pit-table th,
  .pit-table td {
    padding: 0.5rem 0.75rem;
    text-align: left;
  }

  .pit-table th {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
    border-bottom: 2px solid var(--border);
  }

  .pit-table td {
    border-bottom: 1px solid var(--border);
  }

  .pit-table tbody tr:hover {
    background-color: var(--surface);
  }

  .flash-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
