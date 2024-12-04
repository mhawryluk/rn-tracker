import { useContext, useEffect, useMemo } from "react";
import { Canvas } from "react-native-wgpu";
import { arrayOf, i32, u32, vec2f, vec4f } from "typegpu/data";
import tgpu, { asReadonly, asUniform, builtin } from "typegpu/experimental";

import { GoalContext } from "../context/GoalContext";
import { TrackerContext } from "../context/TrackerContext";
import { useBuffer, useGPUSetup, useRoot } from "../gpu/utils";

const SPAN_X = 7;
const SPAN_Y = 6;

export const mainVert = tgpu
  .vertexFn(
    { vertexIndex: builtin.vertexIndex },
    {
      pos: builtin.position,
      uv: vec2f,
    }
  )
  .does(
    /* wgsl */ `(@builtin(vertex_index) vertexIndex: u32) -> Output {
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
  }`
  )
  .$uses({
    get Output() {
      return mainVert.Output;
    },
  });

export const mainFrag = tgpu
  .fragmentFn({ uv: vec2f, pos: builtin.position }, vec4f)
  .does(
    /* wgsl */ `(@location(0) uv: vec2f) -> @location(0) vec4f {
    let x = floor(uv.x * f32(span.x));
    let y = floor((1 - uv.y) * f32(span.y));
    let value = values[u32(y * f32(span.x) + x)];

    if value == -1 {
      return vec4f();
    }

    if value < i32(limit) {
      let opacity = (f32(value) / f32(limit)) * 0.2 + 0.8;
      return vec4f(0.76, 0.65, 0.58, opacity);
    }

    let opacity = (f32(value)/f32(2*limit)) * 0.2 + 0.8;
    return vec4f(0.604, 0.694, 0.608, opacity);
  }`
  )
  .$uses({
    "span.x": SPAN_X,
    "span.y": SPAN_Y,
  });

const ValuesData = arrayOf(i32, SPAN_X * SPAN_Y);

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

  const { ref, context } = useGPUSetup(presentationFormat);

  const valuesBuffer = useBuffer(
    ValuesData,
    valuesState,
    ["storage"],
    "values"
  );

  const limitBuffer = useBuffer(u32, goalState, ["uniform"], "limit");

  const pipeline = useMemo(
    () =>
      root
        .withVertex(mainVert, {})
        .withFragment(
          mainFrag.$uses({
            limit: asUniform(limitBuffer),
            values: asReadonly(valuesBuffer),
          }),
          { format: presentationFormat }
        )
        .withPrimitive({
          topology: "triangle-strip",
        })
        .createPipeline(),
    [root]
  );

  useEffect(() => {
    if (!context) {
      return;
    }

    pipeline
      .withColorAttachment({
        view: context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 0],
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(4);

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
