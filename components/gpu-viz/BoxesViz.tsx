import { useIsFocused } from "@react-navigation/native";
import React, { useContext, useMemo, useRef } from "react";
import { Canvas } from "react-native-wgpu";
import * as d from "typegpu/data";
import tgpu, {
  asUniform,
  builtin,
  std,
  TgpuBuffer,
  TgpuFn,
  Uniform,
  wgsl,
} from "typegpu/experimental";

import { TrackerContext } from "../context/TrackerContext";
import { useBuffer, useFrame, useGPUSetup, useRoot } from "../gpu/utils";

// #region constants

const [X, Y, Z] = [3, 3, 3];
const MAX_BOX_SIZE = 15;
const BIG_BOX_BOUNDS = d.vec3f(
  X * MAX_BOX_SIZE,
  Y * MAX_BOX_SIZE,
  Z * MAX_BOX_SIZE
);
const ROTATION_SPEED = 0.5;
const CAMERA_DISTANCE = 100;
const BOX_CENTER = std.mul(0.5, BIG_BOX_BOUNDS);
const UP_AXIS = d.vec3f(0, 1, 0);

// #endregion

// #region data structures and layouts

const BoxStruct = d.struct({
  isActive: d.u32,
  albedo: d.vec4f,
});

const RayStruct = d.struct({
  origin: d.vec3f,
  direction: d.vec3f,
});

const IntersectionStruct = d.struct({
  intersects: d.bool,
  tMin: d.f32,
  tMax: d.f32,
});

const CameraAxesStruct = d.struct({
  right: d.vec3f,
  up: d.vec3f,
  forward: d.vec3f,
});

const CanvasDimsStruct = d.struct({ width: d.u32, height: d.u32 });

const bindGroupLayout = tgpu.bindGroupLayout({
  cameraPosition: { storage: d.vec3f },
  cameraAxes: { storage: CameraAxesStruct },
  canvasDims: { uniform: CanvasDimsStruct },
  boxSize: { uniform: d.u32 },
});

// #endregion

// #region functions

const getBoxIntersection = tgpu
  .fn([d.vec3f, d.vec3f, RayStruct], IntersectionStruct)
  .does(
    /* wgsl */ `(
  boundMin: vec3f,
  boundMax: vec3f,
  ray: RayStruct
) -> IntersectionStruct {
  var output: IntersectionStruct;

  var tMin: f32;
  var tMax: f32;
  var tMinY: f32;
  var tMaxY: f32;
  var tMinZ: f32;
  var tMaxZ: f32;

  if (ray.direction.x >= 0) {
    tMin = (boundMin.x - ray.origin.x) / ray.direction.x;
    tMax = (boundMax.x - ray.origin.x) / ray.direction.x;
  } else {
    tMin = (boundMax.x - ray.origin.x) / ray.direction.x;
    tMax = (boundMin.x - ray.origin.x) / ray.direction.x;
  }

  if (ray.direction.y >= 0) {
    tMinY = (boundMin.y - ray.origin.y) / ray.direction.y;
    tMaxY = (boundMax.y - ray.origin.y) / ray.direction.y;
  } else {
    tMinY = (boundMax.y - ray.origin.y) / ray.direction.y;
    tMaxY = (boundMin.y - ray.origin.y) / ray.direction.y;
  }

  if (tMin > tMaxY) || (tMinY > tMax) {
    return output;
  }

  if (tMinY > tMin) {
    tMin = tMinY;
  }

  if (tMaxY < tMax) {
    tMax = tMaxY;
  }

  if (ray.direction.z >= 0) {
    tMinZ = (boundMin.z - ray.origin.z) / ray.direction.z;
    tMaxZ = (boundMax.z - ray.origin.z) / ray.direction.z;
  } else {
    tMinZ = (boundMax.z - ray.origin.z) / ray.direction.z;
    tMaxZ = (boundMin.z - ray.origin.z) / ray.direction.z;
  }

  if (tMin > tMaxZ) || (tMinZ > tMax) {
    return output;
  }

  if tMinZ > tMin {
    tMin = tMinZ;
  }

  if tMaxZ < tMax {
    tMax = tMaxZ;
  }

  output.intersects = tMin > 0 && tMax > 0;
  output.tMin = tMin;
  output.tMax = tMax;
  return output;
}`
  )
  .$uses({ RayStruct, IntersectionStruct })
  .$name("box_intersection");

const getBox = tgpu
  .fn([d.u32, d.u32, d.u32], IntersectionStruct)
  .does(
    /* wgsl */ `(
  index: u32,
  highest: u32,
  goal: u32,
) -> BoxStruct {
  var albedo: vec4f;
  var isActive: u32;

  if index + 1 > highest {
    isActive = 0;
    albedo = vec4f();
  } else {
    isActive = 1;
    var multiplier: u32 = 1;
    if index >= goal  {
      multiplier = 2;
    }

    let opacity = (f32(index) / f32(multiplier * goal)) * 0.2 + 0.8;
  
    if index + 1 < goal {
      albedo = vec4f(0.76, 0.65, 0.58, opacity);
    } else {
      albedo = vec4f(0.604, 0.694, 0.608, opacity);
    }
  }

  var output: BoxStruct;
  output.isActive = isActive;
  output.albedo = albedo;
  return output;
}`
  )
  .$uses({ BoxStruct })
  .$name("box_intersection");

const vertexFunction = tgpu
  .vertexFn({ vertexIndex: builtin.vertexIndex }, { outPos: builtin.position })
  .does(
    /* wgsl */ `(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2<f32>( 1,  1),
    vec2<f32>( 1, -1),
    vec2<f32>(-1, -1),
    vec2<f32>( 1,  1),
    vec2<f32>(-1, -1),
    vec2<f32>(-1,  1)
   );

  var output: VertexOutput;
  output.outPos = vec4f(pos[vertexIndex], 0, 1);
  return output;
}`
  )
  .$name("vertex_main");

const getGoalSlot = wgsl.slot<TgpuFn<[], d.U32>>();
const getHighestSlot = wgsl.slot<TgpuFn<[], d.U32>>();

const fragmentFunction = tgpu
  .fragmentFn({ outPos: builtin.position }, d.vec4f)
  .does(
    /* wgsl */ `(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let minDim = f32(min(canvasDims.width, canvasDims.height));
  let goal = getGoalSlot();
  let highestValue = getHighestSlot();

  var ray: RayStruct;
  ray.origin = cameraPosition;
  ray.direction += cameraAxes.right * (position.x - f32(canvasDims.width)/2)/minDim;
  ray.direction += cameraAxes.up * (position.y - f32(canvasDims.height)/2)/minDim;
  ray.direction += cameraAxes.forward;
  ray.direction = normalize(ray.direction);

  let bigBoxIntersection = getBoxIntersection(
    -vec3f(f32(boxSize))/2,
    vec3f(
      BIG_BOX_BOUNDS.x,
      BIG_BOX_BOUNDS.y,
      BIG_BOX_BOUNDS.z,
    ) + vec3f(f32(boxSize))/2,
    ray,
  );

  var color = vec4f();

  if bigBoxIntersection.intersects {
    var tMin: f32;
    var intersectionFound = false;

    for (var i = 0; i < X; i = i+1) {
      for (var j = 0; j < Y; j = j+1) {
        for (var k = 0; k < Z; k = k+1) {
          let index = u32(k * X * Y + (Y - j - 1) * X + i);
          let box = getBox(index, highestValue, goal);  
          if box.isActive == 0 {
            continue;
          }

          let intersection = getBoxIntersection(
            vec3f(f32(i), f32(j), f32(k)) * MAX_BOX_SIZE,
            vec3f(f32(i), f32(j), f32(k)) * MAX_BOX_SIZE + vec3f(f32(boxSize)),
            ray,
          );

          if intersection.intersects && (!intersectionFound || intersection.tMin < tMin) {
            color = box.albedo;
            tMin = intersection.tMin;
            intersectionFound = true;
          }
        }
      }
    }
  }

  return color;
}`
  )
  .$uses({
    ...bindGroupLayout.bound,
    getBox,
    RayStruct,
    getBoxIntersection,
    X,
    Y,
    Z,
    MAX_BOX_SIZE,
    BIG_BOX_BOUNDS,
    getGoalSlot,
    getHighestSlot,
  })
  .$name("fragment_main");

// #endregion

export default function BoxesViz({
  goalBuffer,
}: {
  goalBuffer: TgpuBuffer<d.U32> & Uniform;
}) {
  const [trackerState] = useContext(TrackerContext);
  const highestValue = useMemo(
    () => trackerState[trackerState.length - 1],
    [trackerState]
  );

  const root = useRoot();
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const { ref, context } = useGPUSetup(presentationFormat);

  // buffers
  const highestValueBuffer = useBuffer(
    d.u32,
    highestValue,
    ["uniform"],
    "highest value"
  );
  const highestValueUniform = useMemo(
    () => asUniform(highestValueBuffer),
    [highestValueBuffer]
  );

  const cameraPositionBuffer = useBuffer(
    d.vec3f,
    undefined,
    ["storage"],
    "camera_position"
  );

  const cameraAxesBuffer = useBuffer(
    CameraAxesStruct,
    undefined,
    ["storage"],
    "camera_axes"
  );

  const canvasDimsBuffer = useBuffer(
    CanvasDimsStruct,
    undefined,
    ["uniform"],
    "canvas_dims"
  );

  const boxSizeBuffer = useBuffer(d.u32, MAX_BOX_SIZE, ["uniform"], "box_size");

  const goalUniform = useMemo(() => asUniform(goalBuffer), [goalBuffer]);

  // bind groups and layouts

  const renderBindGroup = useMemo(
    () =>
      bindGroupLayout.populate({
        cameraPosition: cameraPositionBuffer,
        cameraAxes: cameraAxesBuffer,
        canvasDims: canvasDimsBuffer,
        boxSize: boxSizeBuffer,
      }),
    []
  );

  // draw

  const pipeline = useMemo(
    () =>
      root
        .with(
          getGoalSlot,
          tgpu
            .fn([], d.u32)
            .does(`() -> u32 { return goal; }`)
            .$uses({ goal: goalUniform })
        )
        .with(
          getHighestSlot,
          tgpu
            .fn([], d.u32)
            .does(`() -> u32 { return highest; }`)
            .$uses({ highest: highestValueUniform })
        )
        .withVertex(vertexFunction, {})
        .withFragment(fragmentFunction, { format: presentationFormat })
        .createPipeline()
        .with(bindGroupLayout, renderBindGroup),
    [root, renderBindGroup]
  );

  const frameNum = useRef(0);
  const frame = (deltaTime: number) => {
    if (!context) {
      return;
    }

    canvasDimsBuffer.write({
      width: context.canvas.width,
      height: context.canvas.height,
    });

    const cameraPos = d.vec3f(
      Math.cos(frameNum.current) * CAMERA_DISTANCE + BOX_CENTER.x,
      BOX_CENTER.y,
      Math.sin(frameNum.current) * CAMERA_DISTANCE + BOX_CENTER.z
    );
    cameraPositionBuffer.write(cameraPos);

    const forwardAxis = std.normalize(std.sub(BOX_CENTER, cameraPos));
    cameraAxesBuffer.write({
      forward: forwardAxis,
      up: UP_AXIS,
      right: std.cross(UP_AXIS, forwardAxis),
    });

    frameNum.current += (ROTATION_SPEED * deltaTime) / 1000;

    // console.log("boxes");

    const texture = context.getCurrentTexture();
    pipeline
      .withColorAttachment({
        view: texture.createView(),
        clearValue: [1, 1, 1, 0],
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(6);

    root.flush();
    context.present();
    // texture.destroy();
  };

  const isFocused = useIsFocused();
  useFrame(frame, isFocused);

  return (
    <Canvas transparent ref={ref} style={{ height: "100%", aspectRatio: 1 }} />
  );
}
