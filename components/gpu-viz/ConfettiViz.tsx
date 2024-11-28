import { PixelRatio } from "react-native";

import { useEffect, useState } from "react";
import { Canvas, useGPUContext } from "react-native-wgpu";

import { useRoot } from "../gpu/utils";
import { arrayOf, f32, struct, vec2f, vec4f } from "typegpu/data";
import tgpu, { asMutable, asUniform, builtin } from "typegpu/experimental";

// constants

const PARTICLE_AMOUNT = 200;
const COLOR_PALETTE: vec4f[] = [
  [154, 177, 155],
  [67, 129, 193],
  [99, 71, 77],
  [239, 121, 138],
  [255, 166, 48],
].map(([r, g, b]) => vec4f(r / 255, g / 255, b / 255, 1));

// data typess

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

export default function ConfettiViz({ shown }: { shown: boolean }) {
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const root = useRoot();

  const [opacity, setOpacity] = useState(0);

  const { device = null } = root ?? {};
  const { ref, context } = useGPUContext();

  useEffect(() => {
    setOpacity(0);

    if (!shown || !context || !root || !context.canvas) {
      return;
    }

    const canvas = context.canvas as HTMLCanvasElement;
    canvas.width = canvas.clientWidth * PixelRatio.get();
    canvas.height = canvas.clientHeight * PixelRatio.get();

    // setup
    context.configure({
      device: root.device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });

    // buffers

    const canvasAspectRatioBuffer = root
      .createBuffer(f32, canvas.width / canvas.height)
      .$usage("uniform");

    const canvasAspectRatioUniform = asUniform(canvasAspectRatioBuffer);

    const particleGeometryBuffer = root
      .createBuffer(
        arrayOf(ParticleGeometry, PARTICLE_AMOUNT),
        Array(PARTICLE_AMOUNT)
          .fill(0)
          .map(() => ({
            angle: Math.floor(Math.random() * 50) - 10,
            tilt: Math.floor(Math.random() * 10) - 10 - 10,
            color:
              COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)],
          }))
      )
      .$usage("vertex");

    const particleDataBuffer = root
      .createBuffer(arrayOf(ParticleData, PARTICLE_AMOUNT))
      .$usage("storage", "uniform", "vertex");

    const deltaTimeBuffer = root.createBuffer(f32).$usage("uniform");
    const timeBuffer = root.createBuffer(f32).$usage("storage");

    // layouts

    const geometryLayout = tgpu.vertexLayout(
      (n: number) => arrayOf(ParticleGeometry, n),
      "instance"
    );

    const dataLayout = tgpu.vertexLayout(
      (n: number) => arrayOf(ParticleData, n),
      "instance"
    );

    const particleDataStorage = asMutable(particleDataBuffer);
    const deltaTimeUniform = asUniform(deltaTimeBuffer);
    const timeStorage = asMutable(timeBuffer);

    // functions

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
        canvasAspectRatio: canvasAspectRatioUniform,
        get VertexOutput() {
          return mainVert.Output;
        },
      });

    const mainFrag = tgpu.fragmentFn(VertexOutput, vec4f).does(/* wgsl */ `
      (@location(0) color: vec4f) -> @location(0) vec4f {
        return color;
      }`);

    const mainCompute = tgpu
      .computeFn([builtin.globalInvocationId], { workgroupSize: [1] })
      .does(
        /* wgsl */ `(@builtin(global_invocation_id) gid: vec3u) {
          let index = gid.x;
          if index == 0 {
            time += deltaTime;
          }
          let phase = (time + particleData[index].seed) / 200; 
          particleData[index].position += particleData[index].velocity * deltaTime / 20 + vec2f(sin(phase) / 600, cos(phase) / 500);
        }`
      )
      .$uses({
        particleData: particleDataStorage,
        deltaTime: deltaTimeUniform,
        time: timeStorage,
      });

    // pipelines

    const renderPipeline = root
      .withVertex(mainVert, {
        tilt: geometryLayout.attrib.tilt,
        angle: geometryLayout.attrib.angle,
        color: geometryLayout.attrib.color,
        center: dataLayout.attrib.position,
      })
      .withFragment(mainFrag, {
        format: presentationFormat,
      })
      .withPrimitive({
        topology: "triangle-strip",
      })
      .createPipeline()
      .with(geometryLayout, particleGeometryBuffer)
      .with(dataLayout, particleDataBuffer);

    const computePipeline = root.withCompute(mainCompute).createPipeline();

    // compute and draw

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

    let disposed = false;

    function onFrame(loop: (deltaTime: number) => unknown) {
      let lastTime = Date.now();
      const runner = () => {
        if (disposed) {
          return;
        }
        const now = Date.now();
        const dt = now - lastTime;
        lastTime = now;
        loop(dt);
        requestAnimationFrame(runner);
      };
      requestAnimationFrame(runner);
    }

    onFrame((deltaTime) => {
      deltaTimeBuffer.write(deltaTime);
      canvasAspectRatioBuffer.write(canvas.width / canvas.height);

      computePipeline.dispatchWorkgroups(PARTICLE_AMOUNT);

      particleDataBuffer.read().then((data) => {
        if (
          data.every(
            (particle) =>
              (particle.position.x < 0 || particle.position.x > 1) &&
              (particle.position.y < 0 || particle.position.y > 1)
          )
        ) {
          disposed = true;
        }
      });

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

      setOpacity(1);
    });

    context.configure({
      device: root.device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });

    return () => {
      disposed = true;
      root.destroy();
    };
  }, [context, device, root, shown]);

  return (
    <Canvas
      ref={ref}
      style={{
        position: "absolute",
        opacity: opacity,
        width: "100%",
        height: "100%",
        zIndex: 20,
        pointerEvents: "none",
        cursor: "auto",
      }}
    />
  );
}
