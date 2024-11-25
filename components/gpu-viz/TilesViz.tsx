import { PixelRatio } from "react-native";

import { useContext, useEffect, useState } from "react";
import { arrayOf, i32, struct, u32 } from "typegpu/data";
import { Canvas, useGPUContext } from "react-native-wgpu";

import tgpu, {
  AnyTgpuData,
  type TgpuBindGroup,
  type TgpuBuffer,
} from "typegpu";
import { TrackerContext } from "../trackerContext";
import { useRoot } from "../gpu/utils";

const Span = struct({
  x: u32,
  y: u32,
});

const bindGroupLayout = tgpu.bindGroupLayout({
  span: { uniform: Span },
  values: { storage: (n: number) => arrayOf(i32, n) },
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

    let opacity = (f32(value)/f32(span.x * span.y)*0.5) + 0.8;

    return vec4f(0.63, 0.81, 0.84, opacity);
  }`;

interface RenderingState {
  pipeline: GPURenderPipeline;
  spanBuffer: TgpuBuffer<typeof Span>;
  valuesBuffer: TgpuBuffer<AnyTgpuData>;
  bindGroup: TgpuBindGroup<(typeof bindGroupLayout)["entries"]>;
}

export default function TilesViz() {
  const [trackerState, _] = useContext(TrackerContext);
  const today = new Date(Date.now());
  const valuesState = [
    ...new Array(4).fill(-1),
    ...trackerState,
    ...new Array(30 - trackerState.length).fill(-2),
    ...new Array(1).fill(-1),
  ];

  const spanX = 7;
  const spanY = 5;

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const root = useRoot();

  const [state, setState] = useState<null | RenderingState>(null);
  const { device = null } = root ?? {};
  const { ref, context } = useGPUContext();

  useEffect(() => {
    if (!device || !root || !context || state !== null) {
      return;
    }

    const canvas = context.canvas as HTMLCanvasElement;
    canvas.width = canvas.clientWidth * PixelRatio.get();
    canvas.height = canvas.clientHeight * PixelRatio.get();
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });

    const spanBuffer = root
      .createBuffer(Span, { x: spanX, y: spanY })
      .$usage("uniform");

    const valuesBuffer = root
      .createBuffer(arrayOf(i32, valuesState.length), valuesState)
      .$usage("storage");

    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [root.unwrap(bindGroupLayout)],
      }),
      vertex: {
        module: device.createShaderModule({ code: vertWGSL }),
      },
      fragment: {
        module: device.createShaderModule({ code: fragWGSL }),
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
    });

    setState({ bindGroup, pipeline, spanBuffer, valuesBuffer });
  }, [context, device, root, presentationFormat, state]);

  useEffect(() => {
    if (!context || !device || !root || !state) {
      return;
    }

    const { bindGroup, pipeline, spanBuffer, valuesBuffer } = state;
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
    valuesBuffer.write(valuesState);

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, root.unwrap(bindGroup));
    passEncoder.draw(4);
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
    context.present();
  }, [context, device, root, spanX, spanY, state, valuesState]);

  return <Canvas ref={ref} style={{ height: "100%", aspectRatio: 1 }}></Canvas>;
}
