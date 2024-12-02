import { useEffect, useMemo, useRef, useState } from "react";
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
  device: GPUDevice | undefined,
  presentationFormat: GPUTextureFormat
) {
  useEffect(() => {
    if (!context || !device) {
      return;
    }

    const canvas = context.canvas as HTMLCanvasElement;
    canvas.width = canvas.clientWidth * PixelRatio.get();
    canvas.height = canvas.clientHeight * PixelRatio.get();

    context.configure({
      device: device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });
  }, [context, device, presentationFormat]);
}

export function useBuffer<T extends AnyTgpuData>(
  root: ExperimentalTgpuRoot | null,
  schema: T,
  value: Parsed<T> | undefined,
  usage: "uniform" | "storage" | "vertex",
  label?: string
) {
  const buffer = useMemo(
    () => root?.createBuffer(schema).$usage(usage).$name(label),
    [root]
  );

  useEffect(() => {
    if (value !== undefined && buffer && !buffer.destroyed) {
      buffer.write(value);
    }
  }, [buffer, value]);

  return buffer;
}

export function useBufferState<T extends AnyTgpuData>(
  root: ExperimentalTgpuRoot | null,
  schema: T,
  initialValue: Parsed<T> | undefined,
  usage: "uniform" | "storage" | "vertex",
  label?: string
) {
  const [value, setValue] = useState(initialValue);

  const buffer = useMemo(
    () => root?.createBuffer(schema).$usage(usage).$name(label),
    [root]
  );

  useEffect(() => {
    if (value !== undefined && buffer && !buffer.destroyed) {
      buffer.write(value);
    }
  }, [buffer, value]);

  return [buffer, [value, setValue]] as const;
}

export function useFrame(loop: (deltaTime: number) => unknown) {
  const frame = useRef<number | undefined>();

  useEffect(() => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
    }
    let lastTime = Date.now();
    const runner = () => {
      const now = Date.now();
      const dt = now - lastTime;
      lastTime = now;
      loop(dt);
      frame.current = requestAnimationFrame(runner);
    };
    frame.current = requestAnimationFrame(runner);
  }, [loop]);

  return () => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
    }
  };
}
