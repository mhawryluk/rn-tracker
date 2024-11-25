import { PixelRatio, StyleSheet } from "react-native";

import { useContext, useEffect, useMemo, useState } from "react";
import Colors from "../../constants/Colors";
import { struct, u32 } from "typegpu/data";
import { Canvas, useDevice, useGPUContext } from "react-native-wgpu";

import tgpu, { type TgpuBindGroup, type TgpuBuffer } from "typegpu";
import { TrackerContext } from "@/app/_layout";

const Span = struct({
  x: u32,
  y: u32,
});

const bindGroupLayout = tgpu.bindGroupLayout({
  span: { uniform: Span },
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
  
  @fragment
  fn main(
    @location(0) uv: vec2f,
  ) -> @location(0) vec4f {
    let red = floor(uv.x * f32(span.x)) / f32(span.x);
    let green = floor(uv.y * f32(span.y)) / f32(span.y);
    return vec4(red, green, 0.5, 1.0);
  }`;

interface RenderingState {
  pipeline: GPURenderPipeline;
  spanBuffer: TgpuBuffer<typeof Span>;
  bindGroup: TgpuBindGroup<(typeof bindGroupLayout)["entries"]>;
}

function useRoot() {
  const { device } = useDevice();

  return useMemo(
    () => (device ? tgpu.initFromDevice({ device }) : null),
    [device]
  );
}

export default function TilesViz() {
  const [trackerState, _] = useContext(TrackerContext);

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const [state, setState] = useState<null | RenderingState>(null);
  const [spanX, setSpanX] = useState(7);
  const [spanY, setSpanY] = useState(4);
  const root = useRoot();
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
    });

    const spanBuffer = root
      .createBuffer(Span, { x: 10, y: 10 })
      .$usage("uniform");

    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [root.unwrap(bindGroupLayout)],
      }),
      vertex: {
        module: device.createShaderModule({
          code: vertWGSL,
        }),
      },
      fragment: {
        module: device.createShaderModule({
          code: fragWGSL,
        }),
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
    });

    setState({ bindGroup, pipeline, spanBuffer });
  }, [context, device, root, presentationFormat, state]);

  useEffect(() => {
    if (!context || !device || !root || !state) {
      return;
    }

    const { bindGroup, pipeline, spanBuffer } = state;
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

    spanBuffer.write({ x: spanX, y: spanY });

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, root.unwrap(bindGroup));
    passEncoder.draw(4);
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
    context.present();
  }, [context, device, root, spanX, spanY, state]);

  return <Canvas ref={ref} style={{ height: "100%", width: "100%" }}></Canvas>;
}

const styles = StyleSheet.create({
  viz: {
    flex: 2,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.lightTint,
    borderRadius: 20,
    overflow: "hidden",
  },
});
