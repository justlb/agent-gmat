import { useEffect, useRef, useState } from 'react'

import { requestApiJson } from '../../app/apiClient'

type TrajectoryPosition = { iso: string; xKm: number; yKm: number; zKm: number }
type TrajectoryResponse = { frame: 'EarthMJ2000Eq'; positions: TrajectoryPosition[]; samples: number }

declare global {
  interface Window {
    CESIUM_BASE_URL?: string
    Cesium?: any
  }
}

const CESIUM_VERSION = '1.136.0'
const CESIUM_BASE_URL = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`
let cesiumRuntime: Promise<any> | null = null

function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium)
  if (cesiumRuntime) return cesiumRuntime
  cesiumRuntime = new Promise((resolve, reject) => {
    window.CESIUM_BASE_URL = CESIUM_BASE_URL
    const stylesheetId = 'cesium-widgets-stylesheet'
    if (!document.getElementById(stylesheetId)) {
      const stylesheet = document.createElement('link')
      stylesheet.id = stylesheetId
      stylesheet.rel = 'stylesheet'
      stylesheet.href = `${CESIUM_BASE_URL}Widgets/widgets.css`
      document.head.appendChild(stylesheet)
    }
    const scriptId = 'cesium-runtime-script'
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => window.Cesium ? resolve(window.Cesium) : reject(new Error('Cesium runtime did not load.')), { once: true })
      existing.addEventListener('error', () => reject(new Error('Unable to load Cesium. Check the network connection.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = scriptId
    script.src = `${CESIUM_BASE_URL}Cesium.js`
    script.async = true
    script.onload = () => window.Cesium ? resolve(window.Cesium) : reject(new Error('Cesium runtime did not load.'))
    script.onerror = () => reject(new Error('Unable to load Cesium. Check the network connection.'))
    document.head.appendChild(script)
  })
  return cesiumRuntime
}

export function CesiumOrbitViewer({ runPath }: { runPath: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<any>(null)
  const [status, setStatus] = useState('Loading GMAT OEM trajectory…')

  useEffect(() => {
    let cancelled = false
    let viewer: any
    const showOrbit = async () => {
      setStatus('Loading GMAT OEM trajectory…')
      try {
        const [Cesium, trajectory] = await Promise.all([
          loadCesium(),
          requestApiJson<TrajectoryResponse>('/vts/trajectory', { body: JSON.stringify({ runPath }), headers: { 'Content-Type': 'application/json' }, method: 'POST' }),
        ])
        if (cancelled || !containerRef.current) return
        viewer = new Cesium.Viewer(containerRef.current, {
          animation: true,
          baseLayer: false,
          baseLayerPicker: false,
          fullscreenButton: true,
          geocoder: false,
          homeButton: true,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          timeline: true,
        })
        viewerRef.current = viewer
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#020b16')
        // Natural Earth II is shipped with the Cesium runtime.  It gives the
        // globe a real Earth surface without requiring an Ion access token.
        viewer.imageryLayers.addImageryProvider(new Cesium.TileMapServiceImageryProvider({
          url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
        }))
        viewer.scene.globe.showGroundAtmosphere = true
        viewer.scene.globe.enableLighting = true

        const positions = trajectory.positions.map(position => Cesium.Cartesian3.fromElements(position.xKm * 1000, position.yKm * 1000, position.zKm * 1000))
        const sampledPosition = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.INERTIAL)
        for (let index = 0; index < trajectory.positions.length; index += 1) sampledPosition.addSample(Cesium.JulianDate.fromIso8601(trajectory.positions[index].iso), positions[index])
        const firstPosition = trajectory.positions[0]!
        const lastPosition = trajectory.positions[trajectory.positions.length - 1]!
        const start = Cesium.JulianDate.fromIso8601(firstPosition.iso)
        const stop = Cesium.JulianDate.fromIso8601(lastPosition.iso)
        const durationSeconds = Math.max(1, Cesium.JulianDate.secondsDifference(stop, start))
        const satellite = viewer.entities.add({
          availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
          path: { leadTime: 0, material: Cesium.Color.CYAN, resolution: 60, trailTime: durationSeconds, width: 2 },
          point: { color: Cesium.Color.WHITE, outlineColor: Cesium.Color.CYAN, outlineWidth: 2, pixelSize: 8 },
          position: sampledPosition,
        })
        viewer.clock.startTime = start.clone()
        viewer.clock.stopTime = stop.clone()
        viewer.clock.currentTime = start.clone()
        viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP
        viewer.clock.multiplier = Math.max(1, durationSeconds / 180)
        viewer.timeline.zoomTo(start, stop)
        void viewer.zoomTo(satellite)
        setStatus(`${trajectory.samples} real GMAT OEM samples · ${trajectory.frame}`)
      } catch (reason) {
        if (!cancelled) setStatus(reason instanceof Error ? reason.message : 'Unable to display the GMAT trajectory.')
      }
    }
    void showOrbit()
    return () => {
      cancelled = true
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
      viewerRef.current = null
    }
  }, [runPath])

  return <section className="cesium-orbit-viewer">
    <div className="cesium-orbit-viewer-heading"><strong>Orbit visualisation</strong><span>{status}</span></div>
    <div aria-label="Interactive GMAT orbit in Cesium" className="cesium-orbit-canvas" ref={containerRef} role="application" />
  </section>
}
