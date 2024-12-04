import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio } from "react-native";
import { RNCanvasContext, useCanvasEffect } from "react-native-wgpu";

import { Parsed } from "typegpu/data";
import { AnyTgpuData, ExperimentalTgpuRoot } from "typegpu/experimental";
import { RootContext } from "../context/RootContext";
import { useFocusEffect } from "expo-router";

export function useRoot(): ExperimentalTgpuRoot {
  const root = useContext(RootContext);
  if (root === null) {
    throw new Error("please provide root");
  }
  return root;
}


export function useGPUSetup(
  presentationFormat: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat()
) {
  const root = useRoot();
  const [context, setContext] = useState<RNCanvasContext | null>(null);

  const ref = useCanvasEffect(() => {
    const ctx = ref.current?.getContext("webgpu")!;

    if (!ctx) {
      setContext(null);
      return;
    }

    const canvas = ctx.canvas as HTMLCanvasElement;
    canvas.width = canvas.clientWidth * PixelRatio.get();
    canvas.height = canvas.clientHeight * PixelRatio.get();

    ctx.configure({
      device: root.device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });

    setContext(ctx);
  });

  return { ref, context };
}

export function useBuffer<T extends AnyTgpuData>(
  schema: T,
  value: Parsed<T> | undefined,
  usage: ("uniform" | "storage" | "vertex")[],
  label?: string
) {
  const root = useRoot();
  const buffer = useMemo(
    () => root.createBuffer(schema, value).$usage(...usage).$name(label),
    [root, schema, label, ...usage]
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

  useFocusEffect(useCallback(() => {
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
  }, [loop]));
}
