declare module "three/webgpu" {
  export * from "three"

  export interface WebGPURenderer extends import("three").WebGLRenderer {
    readonly isWebGPURenderer: true
    backend?: { isWebGPUBackend?: boolean }
    init(): Promise<void>
  }

  export const WebGPURenderer: {
    new (parameters?: Record<string, unknown>): WebGPURenderer
  }

  export interface MeshStandardNodeMaterial extends import("three").MeshStandardMaterial {
    colorNode: any
    roughnessNode: any
    outputNode: any
    normalNode: any
  }

  export const MeshStandardNodeMaterial: {
    new (parameters?: import("three").MeshStandardMaterialParameters): MeshStandardNodeMaterial
  }

  export interface MeshBasicNodeMaterial extends import("three").MeshBasicMaterial {
    outputNode: any
  }

  export const MeshBasicNodeMaterial: {
    new (parameters?: import("three").MeshBasicMaterialParameters): MeshBasicNodeMaterial
  }
}

declare module "three/tsl" {
  export const cameraPosition: any
  export const normalWorldGeometry: any
  export const output: any
  export const positionWorld: any

  export function bumpMap(value: any): any
  export function color(value: any): any
  export function max(...values: any[]): any
  export function mix(...values: any[]): any
  export function normalize(value: any): any
  export function step(edge: any, value: any): any
  export function texture(...args: any[]): any
  export function uniform<T = any>(value: T): { value: T }
  export function uv(): any
  export function vec3(...values: any[]): any
  export function vec4(...values: any[]): any
}
