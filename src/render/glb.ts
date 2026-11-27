/**
 * Loading the Blender-made models (`public/models/*.glb.gz`).
 *
 * The models are zipped (gzip) to about a fifth of their size, and the
 * browser unzips them itself. If a server has already unzipped the file on
 * the way (its first bytes are then "glTF"), it's used as it is.
 */
import type * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load ${url}: ${res.status}`)
  const bytes = await res.arrayBuffer()
  const head = new Uint8Array(bytes, 0, 2)
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

/** Load `public/models/<name>.glb.gz` and hand back its scene. */
export async function loadGlb(name: string): Promise<THREE.Group> {
  // Relative to the page, so it works at the site's root and under a sub-path.
  const url = new URL(`./models/${name}.glb.gz`, document.baseURI).href
  const gltf = await loader.parseAsync(await fetchModel(url), '')
  return gltf.scene
}
