import { useContext, useEffect, useMemo } from 'react';
import { Canvas } from 'react-native-wgpu';
import tgpu, { type UniformFlag, type TgpuBuffer, type TgpuFn } from 'typegpu';
import * as d from 'typegpu/data';

import { GoalContext } from '../context/GoalContext';
import { TrackerContext } from '../context/TrackerContext';
import { useBuffer, useGPUSetup, useRoot } from '../gpu/utils';

const SPAN_X = 7;
const SPAN_Y = 6;

export const mainVert = tgpu['~unstable']
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex },
    out: {
      pos: d.builtin.position,
      uv: d.vec2f,
    },
  })
  .does(/* wgsl */ `(in: VertexIn) -> Output {
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
    out.pos = vec4f(pos[in.vertexIndex], 0.0, 1.0);
    out.uv = uv[in.vertexIndex];
    return out;
  }`);

const getLimitSlot = tgpu['~unstable'].slot<TgpuFn<[], d.U32>>();
const getValuesSlot = tgpu['~unstable'].slot<TgpuFn<[], d.WgslArray<d.I32>>>();

export const mainFrag = tgpu['~unstable']
  .fragmentFn({ in: { uv: d.vec2f, pos: d.builtin.position }, out: d.vec4f })
  .does(
    /* wgsl */ `(in: FragmentIn) -> @location(0) vec4f {
    let limit = getLimitSlot();
    let x = floor(in.uv.x * f32(span.x));
    let y = floor((1 - in.uv.y) * f32(span.y));
    let value = getValuesSlot()[u32(y * f32(span.x) + x)];

    if value == -1 {
      return vec4f();
    }

    if value == -2 {
      return  vec4f(229.0/255, 222.0/255, 216.0/255, 1);
    }

    if value < i32(limit) {
      let opacity = (f32(value) / f32(limit)) * 0.2 + 0.8;
      return vec4f(0.76, 0.65, 0.58, opacity);
    }

    let opacity = (f32(value)/f32(2*limit)) * 0.2 + 0.8;
    return vec4f(0.604, 0.694, 0.608, opacity);
  }`,
  )
  .$uses({
    getLimitSlot,
    getValuesSlot,
    span: {
      x: SPAN_X,
      y: SPAN_Y,
    },
  });

const ValuesData = d.arrayOf(d.i32, SPAN_X * SPAN_Y);

const now = new Date(Date.now());
const daysInMonth = new Date(
  now.getFullYear(),
  now.getMonth() + 1,
  0,
).getDate();
const firstDayOfTheWeek =
  ((new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7) + 1;

export default function TilesViz({
  goalBuffer,
}: {
  goalBuffer: TgpuBuffer<d.U32> & UniformFlag;
}) {
  const [goalState] = useContext(GoalContext);
  const [trackerState] = useContext(TrackerContext);
  const valuesState = [
    ...new Array(firstDayOfTheWeek - 1).fill(-1),
    ...trackerState,
    ...new Array(daysInMonth - trackerState.length).fill(-2),
    ...new Array(
      Math.max(0, SPAN_X * SPAN_Y - (firstDayOfTheWeek - 1 + daysInMonth)),
    ).fill(-1),
  ];

  const root = useRoot();
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const { ref, context } = useGPUSetup(presentationFormat);

  const valuesBuffer = useBuffer(ValuesData, valuesState, 'values').$usage(
    'storage',
  );

  const pipeline = useMemo(
    () =>
      root['~unstable']
        .with(
          getLimitSlot,
          tgpu['~unstable']
            .fn([], d.u32)
            .does('() -> u32 { return limit; }')
            .$uses({ limit: goalBuffer.as('uniform') }),
        )
        .with(
          getValuesSlot,
          tgpu['~unstable']
            .fn([], d.arrayOf(d.i32, SPAN_X * SPAN_Y))
            .does('() -> array<i32, SPAN_X * SPAN_Y> { return values; }')
            .$uses({
              values: valuesBuffer.as('readonly'),
              SPAN_X,
              SPAN_Y,
            }),
        )
        .withVertex(mainVert, {})
        .withFragment(mainFrag, { format: presentationFormat })
        .withPrimitive({
          topology: 'triangle-strip',
        })
        .createPipeline(),
    [root, goalBuffer, presentationFormat, valuesBuffer],
  );

  useEffect(() => {
    if (!context) {
      return;
    }

    const texture = context.getCurrentTexture();

    pipeline
      .withColorAttachment({
        view: texture.createView(),
        clearValue: [1, 1, 1, 0],
        loadOp: 'clear',
        storeOp: 'store',
      })
      .draw(4);

    root['~unstable'].flush();
    context.present();
  }, [context, pipeline, root]);

  return (
    <Canvas
      transparent
      ref={ref}
      style={{
        height: '100%',
        aspectRatio: 1,
        padding: 20,
      }}
    />
  );
}
