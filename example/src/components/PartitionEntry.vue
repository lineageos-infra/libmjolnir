<script setup lang="ts">
import { libpit } from 'libmjolnir'
import { ref } from 'vue'

defineProps<{ entry: libpit.PitEntry }>()

const emit = defineEmits(['flash'])

const currentFile = ref<File>()

function stageFile(event: Event) {
  currentFile.value = (event.target as HTMLInputElement).files?.[0]
}

function flashPartition(partitionName: string) {
  if (!currentFile.value) {
    return
  }

  emit('flash', {
    name: partitionName,
    data: currentFile.value
  })
}
</script>

<template>
  <tr>
    <td>{{ entry.identifier }}</td>
    <td>{{ entry.partitionName }}</td>
    <td>{{ entry.flashFilename }}</td>
    <td>{{ libpit.EntryDeviceType[entry.deviceType] }}</td>
    <td>{{ entry.binaryType === libpit.EntryBinaryType.CommunicationProcessor ? 'CP' : 'AP' }}</td>
    <td>{{ entry.blockSizeOrOffset }}</td>
    <td>
      <div v-if="entry.isFlashable" class="flash-cell">
        <input :id="`flash-${entry.identifier}`" type="file" @change="stageFile" />
        <button :disabled="!currentFile" @click="flashPartition(entry.partitionName)">
          Flash partition
        </button>
      </div>
    </td>
  </tr>
</template>
