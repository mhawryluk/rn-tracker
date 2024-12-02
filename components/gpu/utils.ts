import { useCallback, useEffect, useMemo, useRef } from "react";
import { PixelRatio } from "react-native";
import { RNCanvasContext, useDevice } from "react-native-wgpu";
import tgpu, { AnyTgpuData } from "typegpu";
import { Parsed } from "typegpu/data";
import { ExperimentalTgpuRoot } from "typegpu/experimental";

export function useRoot() {
  const { device } = useDevice();

  return useMemo(
    () => (device ? tgpu.initFromDevice({ device }) : null),
    [device]
  );
}

export function useGPUSetup(
  context: RNCanvasContext | null,
  root: ExperimentalTgpuRoot | null,
  presentationFormat: GPUTextureFormat
) {
  useEffect(() => {
    if (!context || !root) {
      return;
    }

    const canvas = context.canvas as HTMLCanvasElement;
    canvas.width = canvas.clientWidth * PixelRatio.get();
    canvas.height = canvas.clientHeight * PixelRatio.get();

    context.configure({
      device: root.device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });
  }, [context, root, presentationFormat]);
}

export function useBuffer<T extends AnyTgpuData>(
  root: ExperimentalTgpuRoot | null,
  schema: T,
  value: Parsed<T> | undefined,
  usage: ("uniform" | "storage" | "vertex")[],
  label?: string
) {
  const buffer = useMemo(
    () => root?.createBuffer(schema).$usage(...usage).$name(label),
    [root]
  );

  useEffect(() => {
    if (value !== undefined && buffer && !buffer.destroyed) {
      buffer.write(value);
    }
  }, [buffer, value]);

  return buffer;
}

export function useFrame(loop: (deltaTime: number, dispose: () => void) => unknown) {
  const frame = useRef<number | undefined>();
  const dispose = useCallback(() => {
    console.log("disposing animation")
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
    }
  }, []);

  useEffect(() => {
    dispose();

    let lastTime = Date.now();
    const runner = () => {
      const now = Date.now();
      const dt = now - lastTime;
      lastTime = now;
      loop(dt, dispose);
      frame.current = requestAnimationFrame(runner);
    };
    frame.current = requestAnimationFrame(runner);

    return dispose
  }, [loop]);
}
