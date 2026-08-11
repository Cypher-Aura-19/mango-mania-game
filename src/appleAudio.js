/* One Web Audio output for iPhone/iPad.
 *
 * iOS historically ignores HTMLMediaElement.volume and may allow only one
 * inline media stream at a time. "Warming" many <audio> elements at volume 0
 * can therefore play them audibly and interrupt BGM. Decoded Web Audio buffers
 * mix through one gesture-resumed AudioContext and use real GainNodes. */

const decode = (context, bytes) => new Promise((resolve, reject) => {
  // Older Safari uses callbacks; newer Safari also returns a Promise. Supplying
  // callbacks works on both and avoids decoding the same ArrayBuffer twice.
  context.decodeAudioData(bytes, resolve, reject)
})

export const createAppleAudio = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext || !window.fetch) return null

  const context = new AudioContext()
  const entries = {}
  const active = {}
  const pending = {}
  const playCounts = {}

  const mixer = {
    context,
    playCounts,
    register(name, url, volume = 1) {
      if (entries[name]) return entries[name].ready
      const entry = { name, url, volume, buffer: null, error: null }
      entry.ready = window.fetch(url, { cache: 'force-cache' })
        .then(response => {
          if (!response.ok) throw new Error(`Audio ${response.status}: ${url}`)
          return response.arrayBuffer()
        })
        .then(bytes => decode(context, bytes))
        .then(buffer => {
          entry.buffer = buffer
          if (pending[name] && context.state === 'running') {
            const request = pending[name]
            delete pending[name]
            mixer.play(name, request)
          }
          return buffer
        })
        .catch(error => {
          entry.error = error
          delete pending[name]
          return null
        })
      entries[name] = entry
      return entry.ready
    },
    whenReady(name) {
      return entries[name] ? entries[name].ready : Promise.resolve(null)
    },
    duration(name) {
      const entry = entries[name]
      return entry && entry.buffer ? entry.buffer.duration : 0
    },
    isPlaying(name) {
      return !!active[name]
    },
    unlock() {
      const resumed = context.state === 'running'
        ? Promise.resolve()
        : context.resume().catch(() => {})
      return resumed.then(() => {
        Object.keys(pending).forEach(name => {
          const request = pending[name]
          delete pending[name]
          mixer.play(name, request)
        })
      })
    },
    play(name, option = {}) {
      const entry = entries[name]
      if (!entry || !entry.buffer || context.state !== 'running') {
        pending[name] = option
        return false
      }
      mixer.stop(name, false)
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = entry.buffer
      source.loop = !!option.loop
      gain.gain.value = option.volume === undefined ? entry.volume : option.volume
      source.connect(gain)
      gain.connect(context.destination)
      const offset = Math.max(0, Math.min(option.offset || 0,
        Math.max(0, entry.buffer.duration - 0.01)))
      const record = { source, gain }
      active[name] = record
      playCounts[name] = (playCounts[name] || 0) + 1
      source.onended = () => {
        if (active[name] === record) delete active[name]
        try { source.disconnect(); gain.disconnect() } catch (e) { /* already disconnected */ }
      }
      source.start(0, offset)
      return true
    },
    stop(name, clearPending = true) {
      if (clearPending) delete pending[name]
      const record = active[name]
      if (!record) return
      delete active[name]
      try { record.source.stop() } catch (e) { /* already ended */ }
      try { record.source.disconnect(); record.gain.disconnect() } catch (e) { /* already disconnected */ }
    },
    stopAll() {
      Object.keys(pending).forEach(name => { delete pending[name] })
      Object.keys(active).forEach(name => mixer.stop(name))
    }
  }

  return mixer
}
