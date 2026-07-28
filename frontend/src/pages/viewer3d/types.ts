import type * as THREE from "three/webgpu"

export type AnnotationPalette = {
  dot: string
  line: string
  text: string
  tint: string
}

export type PartAnnotation = {
  anchorWorld: THREE.Vector3
  componentId: string
  dotEl: SVGCircleElement
  height: number
  labelEl: HTMLDivElement
  lineEl: SVGPolylineElement
  width: number
}

export type Disposable = { dispose: () => void }

export type WebGPURendererRuntime = {
  init: () => Promise<void>
  setPixelRatio: (value: number) => void
  setSize: (width: number, height: number) => void
  setAnimationLoop: (callback: (() => void) | null) => void
  render: (scene: THREE.Scene, camera: THREE.Camera) => void
  dispose: () => void
  domElement: HTMLCanvasElement
  shadowMap: {
    enabled: boolean
    type: THREE.ShadowMapType
  }
  outputColorSpace: THREE.ColorSpace
  toneMapping: THREE.ToneMapping
  toneMappingExposure: number
  backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean }
}

export type ResolvedModel = {
  sessionId: string | null
  runId: string | null
  createdAt: string | null
  updatedAt: string | null
  documentName: string | null
  glbPath: string
  modelUrl: string
  version?: string
}

export type ModelVariant = "original" | "replaced"

export type ViewerModelSource = {
  autoRefresh: boolean
  lookupUrl: string
  variant: ModelVariant
}
