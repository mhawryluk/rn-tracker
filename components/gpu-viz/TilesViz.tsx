import { useContext, useEffect } from "react";
import { Canvas, useGPUContext } from "react-native-wgpu";
import { arrayOf, i32, struct, u32 } from "typegpu/data";

import tgpu from "typegpu/experimental";

import { GoalContext } from "../context/GoalContext";
import { TrackerContext } from "../context/TrackerContext";
import { useBuffer, useGPUSetup, useRoot } from "../gpu/utils";

const Span = struct({
  x: u32,
  y: u32,
});

const bindGroupLayout = tgpu.bindGroupLayout({
  span: { uniform: Span },
  values: { storage: (n: number) => arrayOf(i32, n) },
  limit: { uniform: u32 },
});

export const vertWGSL = `
  struct Output {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
  }
  
  @vertex
  fn main(
    @builtin(vertex_index) vertexIndex: u32,
  ) -> Output {
    var pos = array<vec2f, 4>(
      vec2(1, 1), // top-right
      vec2(-1, 1), // top-left
      vec2(1, -1), // bottom-right
      vec2(-1, -1) // bottom-left
    );
  
    var uv = array<vec2f, 4>(
      vec2(1., 1.), // top-right
      vec2(0., 1.), // top-left
      vec2(1., 0.), // bottom-right
      vec2(0., 0.) // bottom-left
    );
  
    var out: Output;
    out.pos = vec4f(pos[vertexIndex], 0.0, 1.0);
    out.uv = uv[vertexIndex];
    return out;
  }`;

export const fragWGSL = `
  struct Span {
    x: u32,
    y: u32,
  }
  
  @group(0) @binding(0) var<uniform> span: Span;
  @group(0) @binding(1) var<storage> values: array<i32>;
  @group(0) @binding(2) var<uniform> limit: u32;
  
  @fragment
  fn main(
    @location(0) uv: vec2f,
  ) -> @location(0) vec4f {
    let x = floor(uv.x * f32(span.x));
    let y = floor((1 - uv.y) * f32(span.y));
    let value = values[u32(y*f32(span.x) + x)];

    if value == -1 {
      return vec4f();
    }

    if value < i32(limit) {
      let opacity = (f32(value)/f32(limit)) * 0.2 + 0.8;
      return vec4f(0.76, 0.65, 0.58, opacity);
    }

    let opacity = (f32(value)/f32(2*limit)) * 0.2 + 0.8;
    return vec4f(0.604, 0.694, 0.608, opacity);
  }`;

const spanX = 7;
const spanY = 6;

export default function TilesViz() {
  const [goalState] = useContext(GoalContext);
  const [trackerState] = useContext(TrackerContext);
  const valuesState = [
    ...new Array(6).fill(-1),
    ...trackerState,
    ...new Array(31 - trackerState.length).fill(-2),
    ...new Array(5).fill(-1),
  ];

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const root = useRoot();

  const { ref, context } = useGPUContext();

  useGPUSetup(context, presentationFormat);

  const spanBuffer = root
    .createBuffer(Span, { x: spanX, y: spanY })
    .$usage("uniform");

  const valuesBuffer = useBuffer(
    arrayOf(i32, valuesState.length),
    valuesState,
    ["storage"],
    "values"
  );

  const limitBuffer = useBuffer(u32, goalState, ["uniform"]);

  const pipeline = root.device.createRenderPipeline({
    layout: root.device.createPipelineLayout({
      bindGroupLayouts: [root.unwrap(bindGroupLayout)],
    }),
    vertex: {
      module: root.device.createShaderModule({ code: vertWGSL }),
    },
    fragment: {
      module: root.device.createShaderModule({ code: fragWGSL }),
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: "triangle-strip",
    },
  });

  const bindGroup = bindGroupLayout.populate({
    span: spanBuffer,
    values: valuesBuffer,
    limit: limitBuffer,
  });

  useEffect(() => {
    if (!context) {
      return;
    }

    const textureView = context.getCurrentTexture().createView();
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    spanBuffer.write({
      x: spanX,
      y: spanY,
    });

    const commandEncoder = root.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, root.unwrap(bindGroup));
    passEncoder.draw(4);
    passEncoder.end();

    root.device.queue.submit([commandEncoder.finish()]);
    context.present();
  }, [context, valuesState, goalState]);

  return (
    <Canvas
      ref={ref}
      style={{
        height: "100%",
        aspectRatio: 1,
        padding: 20,
      }}
    />
  );
}
