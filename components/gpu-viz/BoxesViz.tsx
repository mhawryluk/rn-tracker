import React, { useContext, useMemo, useRef } from "react";
import { Canvas, useGPUContext } from "react-native-wgpu";
import tgpu, { builtin, std } from "typegpu/experimental";

import { arrayOf, bool, f32, struct, u32, vec3f, vec4f } from "typegpu/data";
import { GoalContext } from "../context/GoalContext";
import { TrackerContext } from "../context/TrackerContext";
import {
  useBuffer,
  useBufferState,
  useFrame,
  useGPUSetup,
  useRoot,
} from "../gpu/utils";

// #region constants

const [X, Y, Z] = [3, 3, 3];
const MAX_BOX_SIZE = 15;
const BIG_BOX_BOUNDS = vec3f(
  X * MAX_BOX_SIZE,
  Y * MAX_BOX_SIZE,
  Z * MAX_BOX_SIZE
);
const ROTATION_SPEED = 0.7;
const CAMERA_DISTANCE = 100;
const BOX_CENTER = std.mul(0.5, BIG_BOX_BOUNDS);
const UP_AXIS = vec3f(0, 1, 0);

// #endregion

// #region data structures

const BoxStruct = struct({
  isActive: u32,
  albedo: vec4f,
});

const RayStruct = struct({
  origin: vec3f,
  direction: vec3f,
});

const IntersectionStruct = struct({
  intersects: bool,
  tMin: f32,
  tMax: f32,
});

const CameraAxesStruct = struct({
  right: vec3f,
  up: vec3f,
  forward: vec3f,
});

const CanvasDimsStruct = struct({ width: u32, height: u32 });
const BoxMatrixData = arrayOf(arrayOf(arrayOf(BoxStruct, Z), Y), X);

// #endregion

// #region functions

const getBoxIntersection = tgpu
  .fn([vec3f, vec3f, RayStruct], IntersectionStruct)
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
  .$name("vertex_main")
  .$uses({
    get VertexOutput() {
      return vertexFunction.Output;
    },
  });

const fragmentFunction = tgpu
  .fragmentFn({ outPos: builtin.position }, vec4f)
  .does(
    /* wgsl */ `(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let minDim = f32(min(canvasDims.width, canvasDims.height));

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
          if boxMatrix[i][j][k].isActive == 0 {
            continue;
          }

          let intersection = getBoxIntersection(
            vec3f(f32(i), f32(j), f32(k)) * MAX_BOX_SIZE,
            vec3f(f32(i), f32(j), f32(k)) * MAX_BOX_SIZE + vec3f(f32(boxSize)),
            ray,
          );

          if intersection.intersects && (!intersectionFound || intersection.tMin < tMin) {
            color = boxMatrix[i][j][k].albedo;
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
    RayStruct,
    getBoxIntersection,
    X,
    Y,
    Z,
    MAX_BOX_SIZE,
    BIG_BOX_BOUNDS,
  })
  .$name("fragment_main");

// #endregion

export default function BoxesViz() {
  const [goalState] = useContext(GoalContext);
  const [trackerState] = useContext(TrackerContext);
  const boxMatrixState = useMemo(
    () =>
      Array.from({ length: X }, (_, i) =>
        Array.from({ length: Y }, (_, j) =>
          Array.from({ length: Z }, (_, k) => {
            const index = k * X * Y + (Y - j - 1) * X + i;
            if (index + 1 > trackerState[trackerState.length - 1]) {
              return {
                isActive: 0,
                albedo: vec4f(),
              };
            }

            const opacity =
              (index / ((index < goalState ? 1 : 2) * goalState)) * 0.2 + 0.8;

            return {
              isActive: 1,
              albedo:
                index + 1 < goalState
                  ? vec4f(0.76, 0.65, 0.58, opacity)
                  : vec4f(0.604, 0.694, 0.608, opacity),
            };
          })
        )
      ),
    [trackerState]
  );

  const root = useRoot();
  const { ref, context } = useGPUContext();

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  useGPUSetup(context, root?.device, presentationFormat);

  // buffers

  const boxMatrixBuffer = useBuffer(
    root,
    BoxMatrixData,
    boxMatrixState,
    "storage",
    "box_array"
  );

  const [cameraPositionBuffer, [cameraPosition, setCameraPosition]] =
    useBufferState(root, vec3f, undefined, "storage", "camera_position");

  const [cameraAxesBuffer, [cameraAxes, setCameraAxes]] = useBufferState(
    root,
    CameraAxesStruct,
    undefined,
    "storage",
    "camera_axes"
  );

  const [canvasDimsBuffer, [canvasDims, setCanvasDims]] = useBufferState(
    root,
    CanvasDimsStruct,
    undefined,
    "uniform",
    "canvas_dims"
  );

  const boxSizeBuffer = useBuffer(
    root,
    u32,
    MAX_BOX_SIZE,
    "uniform",
    "box_size"
  );

  // bind groups and layouts

  const [renderBindGroupLayout, renderBindGroup] = useMemo(() => {
    if (
      !boxMatrixBuffer ||
      !cameraPositionBuffer ||
      !cameraAxesBuffer ||
      !canvasDimsBuffer ||
      !boxSizeBuffer
    ) {
      return [];
    }

    const layout = tgpu.bindGroupLayout({
      boxMatrix: { storage: boxMatrixBuffer.dataType },
      cameraPosition: { storage: cameraPositionBuffer.dataType },
      cameraAxes: { storage: cameraAxesBuffer.dataType },
      canvasDims: { uniform: canvasDimsBuffer.dataType },
      boxSize: { uniform: boxSizeBuffer.dataType },
    });

    const group = layout.populate({
      boxMatrix: boxMatrixBuffer,
      cameraPosition: cameraPositionBuffer,
      cameraAxes: cameraAxesBuffer,
      canvasDims: canvasDimsBuffer,
      boxSize: boxSizeBuffer,
    });

    return [layout, group];
  }, [
    boxMatrixBuffer,
    cameraPositionBuffer,
    cameraAxesBuffer,
    canvasDimsBuffer,
    boxSizeBuffer,
  ]);

  const pipeline = useMemo(() => {
    if (!root || !renderBindGroupLayout || !renderBindGroup) {
      return;
    }

    return root
      .withVertex(vertexFunction, {})
      .withFragment(
        fragmentFunction.$uses({
          ...renderBindGroupLayout.bound,
        }),
        { format: presentationFormat }
      )
      .createPipeline()
      .with(renderBindGroupLayout, renderBindGroup);
  }, [root, renderBindGroupLayout, renderBindGroup]);

  const frame = useRef(0);

  useFrame((deltaTime: number) => {
    if (!root || !context || !pipeline) {
      return;
    }

    setCanvasDims({
      width: context.canvas.width,
      height: context.canvas.height,
    });

    const cameraPos = vec3f(
      Math.cos(frame.current) * CAMERA_DISTANCE + BOX_CENTER.x,
      BOX_CENTER.y,
      Math.sin(frame.current) * CAMERA_DISTANCE + BOX_CENTER.z
    );

    setCameraPosition(cameraPos);
    setCameraAxes(() => {
      const forwardAxis = std.normalize(std.sub(BOX_CENTER, cameraPos));
      return {
        forward: forwardAxis,
        up: UP_AXIS,
        right: std.cross(UP_AXIS, forwardAxis),
      };
    });

    frame.current += (ROTATION_SPEED * deltaTime) / 1000;

    pipeline
      .withColorAttachment({
        view: context.getCurrentTexture().createView(),
        clearValue: [1, 1, 1, 0],
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(6);

    root.flush();
    context.present();
  });

  return (
    <>
      <Canvas ref={ref} style={{ height: "100%", aspectRatio: 1 }} />
    </>
  );
}
