import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { Canvas } from "react-native-wgpu";
import {
  arrayOf,
  bool,
  f32,
  i32,
  struct,
  u32,
  vec2f,
  vec2u,
  vec4f,
  type Parsed,
} from "typegpu/data";
import tgpu, {
  asMutable,
  asReadonly,
  asUniform,
  builtin,
  std,
  wgsl,
  type TgpuBufferMutable,
  type TgpuBufferReadonly,
} from "typegpu/experimental";

import { TrackerContext } from "../context/TrackerContext";
import { useBuffer, useFrame, useGPUSetup, useRoot } from "../gpu/utils";

// constants

const MAX_GRID_SIZE = 64;
const MAX_OBSTACLES = 3;
const SOURCE_RADIUS = 0.05;
const GRID_SIZE = 16;
const TIME_STEP = 50;
const STEPS_PER_TICK = 128;

const obstacles: {
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
}[] = [
  { x: 0, y: 0.5, width: 0.05, height: 1, enabled: true }, // left wall
  { x: 1, y: 0.5, width: 0.1, height: 1, enabled: true }, // right wall
  { x: 0.5, y: 0, width: 1, height: 0.2, enabled: true }, // floor
];

// data structures

const GridData = arrayOf(vec4f, MAX_GRID_SIZE ** 2);
const BoxObstacle = struct({
  center: vec2u,
  size: vec2u,
  enabled: u32,
});
const BoxObstacleArray = arrayOf(BoxObstacle, MAX_OBSTACLES);
const SourceParams = struct({
  center: vec2f,
  radius: f32,
  intensity: f32,
});

type GridData = typeof GridData;
type BoxObstacle = typeof BoxObstacle;

// slots

const outputGridSlot = wgsl.slot<TgpuBufferMutable<GridData>>();
const inputGridSlot = wgsl.slot<
  TgpuBufferReadonly<GridData> | TgpuBufferMutable<GridData>
>();

const randSeed = wgsl.var(vec2f);

// #region functions

const setupRandomSeed = tgpu
  .fn([vec2f])
  .does(
    /* wgsl */ `(coord: vec2f) {
    randSeed = coord;
  }`
  )
  .$uses({ randSeed });

const rand01 = tgpu
  .fn([], f32)
  .does(
    /* wgsl */ `() -> f32 {
      let a = dot(randSeed, vec2f(23.14077926, 232.61690225));
      let b = dot(randSeed, vec2f(54.47856553, 345.84153136));
      randSeed.x = fract(cos(a) * 136.8168);
      randSeed.y = fract(cos(b) * 534.7645);
      return randSeed.y;
    }`
  )
  .$uses({ std, vec2f, randSeed });

const isValidCoord = tgpu
  .fn([i32, i32], bool)
  .does(
    /* wgsl */ `(x: i32, y: i32) -> bool {
      return (x < gridSizeUniform &&
      x >= 0 &&
      y < gridSizeUniform &&
      y >= 0);
  }`
  )
  .$uses({ gridSizeUniform: GRID_SIZE });

const coordsToIndex = tgpu
  .fn([i32, i32], i32)
  .does(
    /* wgsl */ `(x: i32, y: i32) -> i32 { 
    return x + y * gridSizeUniform; 
  }`
  )
  .$uses({ gridSizeUniform: GRID_SIZE });

const getCell = tgpu
  .fn([i32, i32], vec4f)
  .does(
    /* wgsl */ `(x: i32, y : i32) -> vec4f { 
      return inputGridSlot[coordsToIndex(x, y)];
    }`
  )
  .$uses({ coordsToIndex, inputGridSlot });

const setCell = tgpu
  .fn([i32, i32, vec4f])
  .does(
    /* wgsl */ `(x: i32, y: i32, value: vec4f) {
    let index = coordsToIndex(x, y);
    outputGridSlot[index] = value;
  }`
  )
  .$uses({ coordsToIndex, outputGridSlot });

const setVelocity = tgpu
  .fn([i32, i32, vec2f])
  .does(
    /* wgsl */ `(x: i32, y: i32, velocity: vec2f) {
    let index = coordsToIndex(x, y);
    outputGridSlot[index].x = velocity.x;
    outputGridSlot[index].y = velocity.y;
  }`
  )
  .$uses({ coordsToIndex, outputGridSlot });

const addDensity = tgpu
  .fn([i32, i32, f32])
  .does(
    /* wgsl */ `(x: i32, y: i32, density: f32) {
      let index = coordsToIndex(x, y);
      outputGridSlot[index].z = inputGridSlot[index].z + density;
    }`
  )
  .$uses({ coordsToIndex, outputGridSlot, inputGridSlot });

const flowFromCell = tgpu
  .fn([i32, i32, i32, i32], f32)
  .does(
    /* wgsl */ `(my_x: i32, my_y: i32, x: i32, y: i32) -> f32 {
        if (!isValidCoord(x, y)) {
          return 0.;
        }

        let src = getCell(x, y);

        let dest_pos = vec2i(vec2f(f32(x), f32(y)) + src.xy);
        let dest = getCell(dest_pos.x, dest_pos.y);
        let diff = src.z - dest.z;
        var out_flow = min(max(0.01, 0.3 + diff * 0.1), src.z);

        if (length(src.xy) < 0.5) {
          out_flow = 0.;
        }

        if (my_x == x && my_y == y) {
          // 'src.z - out_flow' is how much is left in the src
          return src.z - out_flow;
        }

        if (dest_pos.x == my_x && dest_pos.y == my_y) {
          return out_flow;
        }

        return 0.;
        }`
  )
  .$uses({ getCell, isValidCoord })
  .$name("flow_from_cell");

const isInsideObstacle = tgpu
  .fn([i32, i32], bool)
  .does(
    /* wgsl */ `(x: i32, y: i32) -> bool {
      for (var obs_idx = 0; obs_idx < MAX_OBSTACLES; obs_idx += 1) {
        let obs = obstaclesReadonly[obs_idx];

        if (obs.enabled == 0) {
          continue;
        }

        let min_x = i32(max(0, i32(obs.center.x) - i32(obs.size.x/2)));
        let max_x = i32(max(0, i32(obs.center.x) + i32(obs.size.x/2)));
        let min_y = i32(max(0, i32(obs.center.y) - i32(obs.size.y/2)));
        let max_y = i32(max(0, i32(obs.center.y) + i32(obs.size.y/2)));

        if (x >= min_x && x <= max_x && y >= min_y && y <= max_y) {
          return true;
        }
      }

      return false;
    }`
  )
  .$uses({ MAX_OBSTACLES })
  .$name("is_inside_obstacle");

const isValidFlowOut = tgpu
  .fn([i32, i32], bool)
  .does(
    /* wgsl */ `(x: i32, y: i32) -> bool {
      if (!isValidCoord(x, y)) {
        return false;
      }

      if (isInsideObstacle(x, y)) {
        return false;
      }

      let cell = getCell(x, y);

      return true;
  }`
  )
  .$uses({ isValidCoord, isInsideObstacle, getCell });

const computeVelocity = tgpu
  .fn([i32, i32], vec2f)
  .does(
    /* wgsl */ `(x: i32, y: i32) -> vec2f {
        let gravity_cost = 0.5;

        let neighbor_offsets = array<vec2i, 4>(
          vec2i( 0,  1),
          vec2i( 0, -1),
          vec2i( 1,  0),
          vec2i(-1,  0),
        );

        let cell = getCell(x, y);
        var least_cost = cell.z;

        // Direction choices of the same cost, one is chosen
        // randomly at the end of the process.
        var dir_choices: array<vec2f, 4>;
        var dir_choice_count: u32 = 1;
        dir_choices[0] = vec2f(0., 0.);

        for (var i = 0; i < 4; i++) {
          let offset = neighbor_offsets[i];
          let neighbor_density = getCell(x + offset.x, y + offset.y).z;
          let cost = neighbor_density + f32(offset.y) * gravity_cost;
          let is_valid_flow_out = isValidFlowOut(x + offset.x, y + offset.y);

          if (!is_valid_flow_out) {
            continue;
          }

          if (cost == least_cost) {
            // another valid direction
            dir_choices[dir_choice_count] = vec2f(f32(offset.x), f32(offset.y));
            dir_choice_count++;
          }
          else if (cost < least_cost) {
            // new best choice
            least_cost = cost;
            dir_choices[0] = vec2f(f32(offset.x), f32(offset.y));
            dir_choice_count = 1;
          }
        }

        let least_cost_dir = dir_choices[u32(rand01() * f32(dir_choice_count))];
        return least_cost_dir;
        }`
  )
  .$uses({ getCell, isValidFlowOut, isValidCoord, rand01 });

const mainInitWorld = tgpu
  .computeFn([builtin.globalInvocationId], { workgroupSize: [1] })
  .does(
    /* wgsl */ `(@builtin(global_invocation_id) gid: vec3u) {
        let x = i32(gid.x);
        let y = i32(gid.y);
        let index = coordsToIndex(x, y);

        var value = vec4f();

        if (!isValidFlowOut(x, y)) {
          value = vec4f(0., 0., 0., 0.);
        }
        else {
          // Ocean
          if (y < i32(gridSizeUniform) / 2) {
            let depth = 1. - f32(y) / (f32(gridSizeUniform) / 2.);
            value = vec4f(0., 0., depth * 1, 0.);
          }
        }

        outputGridSlot[index] = value;
      }`
  )
  .$uses({
    gridSizeUniform: GRID_SIZE,
    coordsToIndex,
    isValidFlowOut,
    outputGridSlot,
  });

const mainMoveObstacles = tgpu
  .computeFn([], { workgroupSize: [1] })
  .does(
    /* wgsl */ `() {
      for (var obs_idx = 0; obs_idx < MAX_OBSTACLES; obs_idx += 1) {
        let obs = prevObstacleReadonly[obs_idx];
        let next_obs = obstaclesReadonly[obs_idx];

        if (obs.enabled == 0) {
          continue;
        }

        let diff = vec2i(next_obs.center) - vec2i(obs.center);

        let min_x = i32(max(0, i32(obs.center.x) - i32(obs.size.x/2)));
        let max_x = i32(max(0, i32(obs.center.x) + i32(obs.size.x/2)));
        let min_y = i32(max(0, i32(obs.center.y) - i32(obs.size.y/2)));
        let max_y = i32(max(0, i32(obs.center.y) + i32(obs.size.y/2)));

        let next_min_x = i32(max(0, i32(next_obs.center.x) - i32(obs.size.x/2)));
        let next_max_x = i32(max(0, i32(next_obs.center.x) + i32(obs.size.x/2)));
        let next_min_y = i32(max(0, i32(next_obs.center.y) - i32(obs.size.y/2)));
        let next_max_y = i32(max(0, i32(next_obs.center.y) + i32(obs.size.y/2)));

        // does it move right
        if (diff.x > 0) {
          for (var y = min_y; y <= max_y; y += 1) {
            var row_density = 0.;
            for (var x = max_x; x <= next_max_x; x += 1) {
              var cell = getCell(x, y);
              row_density += cell.z;
              cell.z = 0;
              setCell(x, y, cell);
            }

            addDensity(next_max_x + 1, y, row_density);
          }
        }

        // does it move left
        if (diff.x < 0) {
          for (var y = min_y; y <= max_y; y += 1) {
            var row_density = 0.;
            for (var x = next_min_x; x < min_x; x += 1) {
              var cell = getCell(x, y);
              row_density += cell.z;
              cell.z = 0;
              setCell(x, y, cell);
            }

            addDensity(next_min_x - 1, y, row_density);
          }
        }

        // does it move up
        if (diff.y > 0) {
          for (var x = min_x; x <= max_x; x += 1) {
            var col_density = 0.;
            for (var y = max_y; y <= next_max_y; y += 1) {
              var cell = getCell(x, y);
              col_density += cell.z;
              cell.z = 0;
              setCell(x, y, cell);
            }

            addDensity(x, next_max_y + 1, col_density);
          }
        }

        // does it move down
        if (diff.y < 0) {
          for (var x = min_x; x <= max_x; x += 1) {
            var col_density = 0.;
            for (var y = next_min_y; y < min_y; y += 1) {
              var cell = getCell(x, y);
              col_density += cell.z;
              cell.z = 0;
              setCell(x, y, cell);
            }

            addDensity(x, next_min_y - 1, col_density);
          }
        }

        // Recompute velocity around the obstacle so that no cells end up inside it on the
        // next tick.

        // left column
        for (var y = next_min_y; y <= next_max_y; y += 1) {
          let new_vel = computeVelocity(next_min_x - 1, y);
          setVelocity(next_min_x - 1, y, new_vel);
        }

        // right column
        for (var y = max(1, next_min_y); y <= min(next_max_y, gridSizeUniform - 2); y += 1) {
          let new_vel = computeVelocity(next_max_x + 2, y);
          setVelocity(next_max_x + 2, y, new_vel);
        }
    }
  }`
  )
  .$uses({
    gridSizeUniform: GRID_SIZE,
    MAX_OBSTACLES,
    getCell,
    setCell,
    addDensity,
    computeVelocity,
    setVelocity,
  });

const getMinimumInFlow = tgpu
  .fn([i32, i32], f32)
  .does(
    /* wgsl */ `(x: i32, y: i32) -> f32 {
    let source_params = sourceParamsUniform;
    let grid_size_f = f32(gridSizeUniform);
    let source_radius = max(1., source_params.radius * grid_size_f);
    let source_pos = vec2f(source_params.center.x * grid_size_f, source_params.center.y * grid_size_f);

    if (length(vec2f(f32(x), f32(y)) - source_pos) < source_radius) {
      return source_params.intensity;
    }

    return 0.;
  }`
  )
  .$uses({ gridSizeUniform: GRID_SIZE });

const mainCompute = tgpu
  .computeFn([builtin.globalInvocationId], { workgroupSize: [8, 8] })
  .does(
    /* wgsl */ `(@builtin(global_invocation_id) gid: vec3u) {
        let x = i32(gid.x);
        let y = i32(gid.y);
        let index = coordsToIndex(x, y);

        setupRandomSeed(vec2f(f32(index), timeUniform));

        var next = getCell(x, y);

        let next_velocity = computeVelocity(x, y);
        next.x = next_velocity.x;
        next.y = next_velocity.y;

        // Processing in-flow

        next.z = flowFromCell(x, y, x, y);
        next.z += flowFromCell(x, y, x, y + 1);
        next.z += flowFromCell(x, y, x, y - 1);
        next.z += flowFromCell(x, y, x + 1, y);
        next.z += flowFromCell(x, y, x - 1, y);

        let min_inflow = getMinimumInFlow(x, y);
        next.z = max(min_inflow, next.z);

        outputGridSlot[index] = next;
}`
  )
  .$uses({
    coordsToIndex,
    setupRandomSeed,
    getCell,
    computeVelocity,
    flowFromCell,
    getMinimumInFlow,
    outputGridSlot,
  });

const vertexMain = tgpu
  .vertexFn({ idx: builtin.vertexIndex }, { pos: builtin.position, uv: vec2f })
  .does(
    /* wgsl */ `(@builtin(vertex_index) idx: u32) -> VertexOut {
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

      var output: VertexOut;
      output.pos = vec4f(pos[idx].x, pos[idx].y, 0.0, 1.0);
      output.uv = uv[idx];
      return output;
    }`
  )
  .$uses({
    get VertexOut() {
      return vertexMain.Output;
    },
  });

const fragmentMain = tgpu
  .fragmentFn(
    {
      pos: builtin.position /* TODO: Remove once builtins are properly purged from the types */,
      uv: vec2f,
    },
    vec4f
  )
  .does(
    /* wgsl */ `(@location(0) uv: vec2f) -> @location(0) vec4f {
        let x = i32(uv.x * f32(gridSizeUniform));
        let y = i32(uv.y * f32(gridSizeUniform));

        let index = coordsToIndex(x, y);
        let cell = inputGridSlot[index];
        let velocity = cell.xy;
        let density = max(0., cell.z);

        let obstacle_color = vec4f(0.4006, 0.3210, 0.2784, 1.);

        let background = vec4f(0, 0, 0, 0);
        let first_color = vec4f(0.3310, 0.3381, 0.3310, 1.);
        let second_color = vec4f(0.3169, 0.3642, 0.3189, 1.);
        let third_color = vec4f(0.3091, 0.3758, 0.3152, 1.);

        let first_threshold = 2.;
        let second_threshold = 10.;
        let third_threshold = 20.;

        if (isInsideObstacle(x, y)) {
          return obstacle_color;
        }

        if (density <= 0.) {
          return background;
        }

        if (density <= first_threshold) {
          let t = 1 - pow(1 - density / first_threshold, 2.);
          return mix(background, first_color, t);
        }

        if (density <= second_threshold) {
          return mix(first_color, second_color, (density - first_threshold) / (second_threshold - first_threshold));
        }

        return mix(second_color, third_color, min((density - second_threshold) / third_threshold, 1.));
        }`
  )
  .$uses({
    gridSizeUniform: GRID_SIZE,
    coordsToIndex,
    inputGridSlot,
    isInsideObstacle,
  });

// #endregion

function obstaclesToConcrete(): Parsed<BoxObstacle>[] {
  return obstacles.map(({ x, y, width, height, enabled }) => ({
    center: vec2u(Math.round(x * GRID_SIZE), Math.round(y * GRID_SIZE)),
    size: vec2u(Math.round(width * GRID_SIZE), Math.round(height * GRID_SIZE)),
    enabled: enabled ? 1 : 0,
  }));
}

let sourceIntensity = 0;

export default function WaterViz() {
  const [trackerState] = useContext(TrackerContext);

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const root = useRoot();
  const { ref, context } = useGPUSetup(presentationFormat);

  const gridAlphaBuffer = useBuffer(GridData, undefined, ["storage"]);
  const gridBetaBuffer = useBuffer(GridData, undefined, ["storage"]);

  const prevObstaclesBuffer = useBuffer(BoxObstacleArray, undefined, [
    "storage",
  ]);

  const prevObstacleReadonly = useMemo(
    () => asReadonly(prevObstaclesBuffer),
    [prevObstaclesBuffer]
  );

  const obstaclesBuffer = useBuffer(BoxObstacleArray, undefined, ["storage"]);
  const obstaclesReadonly = useMemo(
    () => asReadonly(obstaclesBuffer),
    [obstaclesBuffer]
  );

  const timeBuffer = useBuffer(f32, undefined, ["uniform"]);
  const timeUniform = useMemo(() => asUniform(timeBuffer), [timeBuffer]);

  const sourceParamsBuffer = useBuffer(SourceParams, undefined, ["uniform"]);
  const sourceParamsUniform = useMemo(
    () => asUniform(sourceParamsBuffer),
    [sourceParamsBuffer]
  );

  getMinimumInFlow.$uses({ sourceParamsUniform });
  isInsideObstacle.$uses({ obstaclesReadonly });
  mainMoveObstacles.$uses({
    prevObstacleReadonly,
    obstaclesReadonly,
  });
  mainCompute.$uses({
    timeUniform,
  });
  fragmentMain.$uses({
    obstaclesReadonly,
  });

  const makePipelines = useCallback(
    (
      inputGridReadonly: TgpuBufferReadonly<GridData>,
      outputGridMutable: TgpuBufferMutable<GridData>
    ) => {
      const initWorldPipeline = root
        .with(inputGridSlot, outputGridMutable)
        .with(outputGridSlot, outputGridMutable)
        .withCompute(mainInitWorld)
        .createPipeline();

      const computePipeline = root
        .with(inputGridSlot, inputGridReadonly)
        .with(outputGridSlot, outputGridMutable)
        .withCompute(mainCompute)
        .createPipeline();

      const moveObstaclesPipeline = root
        .with(inputGridSlot, outputGridMutable)
        .with(outputGridSlot, outputGridMutable)
        .withCompute(mainMoveObstacles)
        .createPipeline();

      const renderPipeline = root
        .with(inputGridSlot, inputGridReadonly)
        .withVertex(vertexMain, {})
        .withFragment(fragmentMain, { format: presentationFormat })
        .withPrimitive({ topology: "triangle-strip" })
        .createPipeline();

      return {
        init() {
          initWorldPipeline.dispatchWorkgroups(GRID_SIZE, GRID_SIZE);
          root.flush();
        },

        applyMovedObstacles(bufferData: Parsed<BoxObstacle>[]) {
          obstaclesBuffer.write(bufferData);
          moveObstaclesPipeline.dispatchWorkgroups(1);
          root.flush();

          prevObstaclesBuffer.write(bufferData);
          root.flush();
        },

        compute() {
          computePipeline.dispatchWorkgroups(
            GRID_SIZE / mainCompute.shell.workgroupSize[0],
            GRID_SIZE / mainCompute.shell.workgroupSize[1]
          );
        },

        render() {
          if (!context) {
            return;
          }

          const textureView = context.getCurrentTexture().createView();

          renderPipeline
            .withColorAttachment({
              view: textureView,
              clearValue: [0, 0, 0, 0],
              loadOp: "clear",
              storeOp: "store",
            })
            .draw(4);
        },
      };
    },
    [context, root, obstaclesBuffer, prevObstaclesBuffer]
  );

  const even = useMemo(
    () => makePipelines(asReadonly(gridAlphaBuffer), asMutable(gridBetaBuffer)),
    [makePipelines, gridAlphaBuffer, gridBetaBuffer]
  );

  const odd = useMemo(
    () => makePipelines(asReadonly(gridBetaBuffer), asMutable(gridAlphaBuffer)),
    [makePipelines, gridBetaBuffer, gridAlphaBuffer]
  );

  const primary = useRef(even);

  useEffect(() => {
    obstaclesBuffer.write(obstaclesToConcrete());
    prevObstaclesBuffer.write(obstaclesToConcrete());
    primary.current.init();
  }, [obstaclesBuffer, prevObstaclesBuffer, primary.current]);

  let msSinceLastTick = useRef(0);

  const tick = useCallback(() => {
    timeBuffer.write(Date.now() % 1000);

    sourceParamsBuffer.write({
      center: vec2f(0.5, 0.9),
      intensity: sourceIntensity,
      radius: SOURCE_RADIUS,
    });

    primary.current = primary.current === even ? odd : even;
    primary.current.compute();
    root.flush();
  }, [root, sourceParamsBuffer, timeBuffer, context]);

  const frame = useCallback(
    (deltaTime: number) => {
      if (!context) {
        return;
      }

      // console.log("water frame");
      msSinceLastTick.current += deltaTime;

      if (msSinceLastTick.current >= TIME_STEP) {
        for (let i = 0; i < STEPS_PER_TICK; ++i) {
          tick();
        }
        primary.current.render();
        root.flush();
        msSinceLastTick.current -= TIME_STEP;
        context.present();
      }
    },
    [context, tick, primary.current]
  );

  useEffect(() => {
    sourceIntensity = 0.1;
    setTimeout(() => (sourceIntensity = 0), 1000);
  }, [trackerState]);

  useFrame(frame);

  return (
    <Canvas
      ref={ref}
      style={{
        height: "100%",
        aspectRatio: 1,
        borderBottomEndRadius: 20,
        borderBottomStartRadius: 20,
        overflow: "hidden",
      }}
    />
  );
}
