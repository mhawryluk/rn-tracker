import { useCallback, useEffect, useMemo } from "react";
import { Canvas, useGPUContext } from "react-native-wgpu";

import { arrayOf, f32, struct, vec2f, vec4f } from "typegpu/data";
import tgpu, { asMutable, asUniform, builtin } from "typegpu/experimental";
import { useBuffer, useFrame, useGPUSetup, useRoot } from "../gpu/utils";

// #region constants

const PARTICLE_AMOUNT = 200;
const COLOR_PALETTE: vec4f[] = [
  [154, 177, 155],
  [67, 129, 193],
  [99, 71, 77],
  [239, 121, 138],
  [255, 166, 48],
].map(([r, g, b]) => vec4f(r / 255, g / 255, b / 255, 1));

// #endregion

// #region data structures

const VertexOutput = {
  position: builtin.position,
  color: vec4f,
};

const ParticleGeometry = struct({
  tilt: f32,
  angle: f32,
  color: vec4f,
});

const ParticleData = struct({
  position: vec2f,
  velocity: vec2f,
  seed: f32,
});

// #endregion

// #region functions

const rotate = tgpu.fn([vec2f, f32], vec2f).does(/* wgsl */ `
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
      tilt: f32,
      angle: f32,
      color: vec4f,
      center: vec2f,
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
  .$uses({
    rotate,
    get VertexOutput() {
      return mainVert.Output;
    },
  });

const mainFrag = tgpu.fragmentFn(VertexOutput, vec4f).does(/* wgsl */ `
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
  let phase = (time + particleData[index].seed) / 200; 
  particleData[index].position += particleData[index].velocity * deltaTime / 20 + vec2f(sin(phase) / 600, cos(phase) / 500);
}`);

// #endregion

// #region layouts

const geometryLayout = tgpu.vertexLayout(
  (n: number) => arrayOf(ParticleGeometry, n),
  "instance"
);

const dataLayout = tgpu.vertexLayout(
  (n: number) => arrayOf(ParticleData, n),
  "instance"
);

// #endregion

export default function ConfettiViz() {
  const root = useRoot();
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const { ref, context } = useGPUSetup(presentationFormat);

  // buffers

  const canvasAspectRatioBuffer = useBuffer(
    f32,
    context ? context.canvas.width / context.canvas.height : 1,
    ["uniform"],
    "aspect_ratio"
  );

  const canvasAspectRatioUniform = useMemo(
    () =>
      canvasAspectRatioBuffer ? asUniform(canvasAspectRatioBuffer) : undefined,
    [canvasAspectRatioBuffer]
  );

  const particleGeometryBuffer = useBuffer(
    arrayOf(ParticleGeometry, PARTICLE_AMOUNT),
    Array(PARTICLE_AMOUNT)
      .fill(0)
      .map(() => ({
        angle: Math.floor(Math.random() * 50) - 10,
        tilt: Math.floor(Math.random() * 10) - 10 - 10,
        color: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)],
      })),
    ["vertex"],
    "particle_geometry"
  );

  const particleDataBuffer = useBuffer(
    arrayOf(ParticleData, PARTICLE_AMOUNT),
    undefined,
    ["storage", "uniform", "vertex"],
    "particle_data"
  );

  const deltaTimeBuffer = useBuffer(f32, undefined, ["uniform"], "delta_time");
  const timeBuffer = useBuffer(f32, undefined, ["storage"], "time");

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

  useEffect(() => {
    // randomize positions
    particleDataBuffer.write(
      Array(PARTICLE_AMOUNT)
        .fill(0)
        .map(() => ({
          position: vec2f(Math.random() * 2 - 1, Math.random() * 2 + 1),
          velocity: vec2f(
            (Math.random() * 2 - 1) / 50,
            -(Math.random() / 25 + 0.01)
          ),
          seed: Math.random(),
        }))
    );
  }, []);

  const frame = useCallback(
    (deltaTime: number, dispose: () => void) => {
      if (!context) {
        return;
      }

      deltaTimeBuffer.write(deltaTime);
      canvasAspectRatioBuffer.write(
        context.canvas.width / context.canvas.height
      );
      computePipeline.dispatchWorkgroups(PARTICLE_AMOUNT);

      particleDataBuffer.read().then((data) => {
        if (
          data.every(
            (particle) =>
              particle.position.x < -1 ||
              particle.position.x > 1 ||
              particle.position.y < -1.5
          )
        ) {
          console.log("confetti animation ended");
          dispose();
        }
      });

      // console.log("draw confetti");
      renderPipeline
        .withColorAttachment({
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: "clear" as const,
          storeOp: "store" as const,
        })
        .draw(4, PARTICLE_AMOUNT);

      root.flush();
      context.present();
    },
    [context]
  );

  useFrame(frame);

  return (
    <Canvas
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
