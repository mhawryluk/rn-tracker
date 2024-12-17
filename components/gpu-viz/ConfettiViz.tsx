import { useMemo, useState } from "react";
import { Canvas } from "react-native-wgpu";

import { useIsFocused } from "@react-navigation/native";
import * as d from "typegpu/data";
import tgpu, { asMutable, asUniform, builtin } from "typegpu/experimental";
import { useBuffer, useFrame, useGPUSetup, useRoot } from "../gpu/utils";

// #region constants

const PARTICLE_AMOUNT = 200;
const COLOR_PALETTE: d.v4f[] = [
  [154, 177, 155],
  [67, 129, 193],
  [99, 71, 77],
  [239, 121, 138],
  [255, 166, 48],
].map(([r, g, b]) => d.vec4f(r / 255, g / 255, b / 255, 1));

// #endregion

// #region data structures

const VertexOutput = {
  position: builtin.position,
  color: d.vec4f,
};

const ParticleGeometry = d.struct({
  tilt: d.f32,
  angle: d.f32,
  color: d.vec4f,
});

const ParticleData = d.struct({
  position: d.vec2f,
  velocity: d.vec2f,
  seed: d.f32,
});

const ParticleGeometryArray = d.arrayOf(ParticleGeometry, PARTICLE_AMOUNT);
const ParticleDataArray = d.arrayOf(ParticleData, PARTICLE_AMOUNT);

// #endregion

// #region functions

const rotate = tgpu.fn([d.vec2f, d.f32], d.vec2f).does(/* wgsl */ `
  (v: vec2f, angle: f32) -> vec2f {
    let pos = vec2(
      (v.x * cos(angle)) - (v.y * sin(angle)),
      (v.x * sin(angle)) + (v.y * cos(angle))
    );

    return pos;
}`);

const mainVert = tgpu
  .vertexFn(
    {
      tilt: d.f32,
      angle: d.f32,
      color: d.vec4f,
      center: d.vec2f,
      index: builtin.vertexIndex,
    },
    VertexOutput
  )
  .does(
    /* wgsl */ `(
      @location(0) tilt: f32,
      @location(1) angle: f32,
      @location(2) color: vec4f,
      @location(3) center: vec2f,
      @builtin(vertex_index) index: u32,
    ) -> VertexOutput {
      let width = tilt;
      let height = tilt / 2;

      var pos = rotate(array<vec2f, 4>(
        vec2f(0, 0),
        vec2f(width, 0),
        vec2f(0, height),
        vec2f(width, height),
      )[index] / 350, angle) + center;

      if (canvasAspectRatio < 1) {
        pos.x /= canvasAspectRatio;
      } else {
        pos.y *= canvasAspectRatio;
      }

      return VertexOutput(vec4f(pos, 0.0, 1.0), color);
  }`
  )
  .$uses({ rotate });

const mainFrag = tgpu.fragmentFn(VertexOutput, d.vec4f).does(/* wgsl */ `
  (@location(0) color: vec4f) -> @location(0) vec4f {
    return color;
}`);

const mainCompute = tgpu.computeFn([builtin.globalInvocationId], {
  workgroupSize: [1],
}).does(/* wgsl */ `(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if index == 0 {
    time += deltaTime;
  }
  let phase = (time / 300) + particleData[index].seed; 
  particleData[index].position += particleData[index].velocity * deltaTime / 20 + vec2f(sin(phase) / 600, cos(phase) / 500);
}`);

// #endregion

// #region layouts

const geometryLayout = tgpu.vertexLayout(
  (n: number) => d.arrayOf(ParticleGeometry, n),
  "instance"
);

const dataLayout = tgpu.vertexLayout(
  (n: number) => d.arrayOf(ParticleData, n),
  "instance"
);

// #endregion

export default function ConfettiViz() {
  const root = useRoot();
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const { ref, context } = useGPUSetup(presentationFormat);

  // buffers

  const canvasAspectRatioBuffer = useBuffer(
    d.f32,
    context ? context.canvas.width / context.canvas.height : 1,
    ["uniform"],
    "aspect_ratio"
  );

  const canvasAspectRatioUniform = useMemo(
    () =>
      canvasAspectRatioBuffer ? asUniform(canvasAspectRatioBuffer) : undefined,
    [canvasAspectRatioBuffer]
  );

  const particleGeometry = useMemo(
    () =>
      Array(PARTICLE_AMOUNT)
        .fill(0)
        .map(() => ({
          angle: Math.floor(Math.random() * 50) - 10,
          tilt: Math.floor(Math.random() * 10) - 10 - 10,
          color:
            COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)],
        })),
    []
  );

  const particleGeometryBuffer = useBuffer(
    ParticleGeometryArray,
    particleGeometry,
    ["vertex"],
    "particle_geometry"
  );

  const particleInitialData = useMemo(
    () =>
      Array(PARTICLE_AMOUNT)
        .fill(0)
        .map(() => ({
          position: d.vec2f(Math.random() * 2 - 1, Math.random() * 2 + 1),
          velocity: d.vec2f(
            (Math.random() * 2 - 1) / 50,
            -(Math.random() / 25 + 0.01)
          ),
          seed: Math.random(),
        })),
    []
  );

  const particleDataBuffer = useBuffer(
    ParticleDataArray,
    particleInitialData,
    ["storage", "uniform", "vertex"],
    "particle_data"
  );

  const deltaTimeBuffer = useBuffer(
    d.f32,
    undefined,
    ["uniform"],
    "delta_time"
  );
  const timeBuffer = useBuffer(d.f32, undefined, ["storage"], "time");

  const particleDataStorage = useMemo(
    () => asMutable(particleDataBuffer),
    [particleDataBuffer]
  );
  const deltaTimeUniform = useMemo(
    () => (deltaTimeBuffer ? asUniform(deltaTimeBuffer) : undefined),
    [deltaTimeBuffer]
  );
  const timeStorage = useMemo(
    () => (timeBuffer ? asMutable(timeBuffer) : timeBuffer),
    [timeBuffer]
  );

  // pipelines

  const renderPipeline = useMemo(
    () =>
      root
        .withVertex(
          mainVert.$uses({
            canvasAspectRatio: canvasAspectRatioUniform,
          }),
          {
            tilt: geometryLayout.attrib.tilt,
            angle: geometryLayout.attrib.angle,
            color: geometryLayout.attrib.color,
            center: dataLayout.attrib.position,
          }
        )
        .withFragment(mainFrag, {
          format: presentationFormat,
        })
        .withPrimitive({
          topology: "triangle-strip",
        })
        .createPipeline()
        .with(geometryLayout, particleGeometryBuffer)
        .with(dataLayout, particleDataBuffer),
    []
  );

  const computePipeline = useMemo(
    () =>
      root
        .withCompute(
          mainCompute.$uses({
            particleData: particleDataStorage,
            deltaTime: deltaTimeUniform,
            time: timeStorage,
          })
        )
        .createPipeline(),
    []
  );

  const [ended, setEnded] = useState(false);

  const frame = async (deltaTime: number) => {
    if (!context) {
      return;
    }

    deltaTimeBuffer.write(deltaTime);
    canvasAspectRatioBuffer.write(context.canvas.width / context.canvas.height);
    computePipeline.dispatchWorkgroups(PARTICLE_AMOUNT);

    const data = await particleDataBuffer.read();
    if (
      data.every(
        (particle) =>
          particle.position.x < -1 ||
          particle.position.x > 1 ||
          particle.position.y < -1.5
      )
    ) {
      console.log("confetti animation ended");
      setEnded(true);
    }

    // console.log("draw confetti");
    const texture = context.getCurrentTexture();
    renderPipeline
      .withColorAttachment({
        view: texture.createView(),
        clearValue: [0, 0, 0, 0],
        loadOp: "clear" as const,
        storeOp: "store" as const,
      })
      .draw(4, PARTICLE_AMOUNT);

    root.flush();
    context.present();
    // texture.destroy();
  };

  const isFocused = useIsFocused();
  useFrame(frame, isFocused && !ended);

  return (
    <Canvas
      transparent
      ref={ref}
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        zIndex: 20,
        pointerEvents: "none",
        cursor: "auto",
      }}
    />
  );
}
