import { useMemo } from "react";
import { useDevice } from "react-native-wgpu";
import tgpu from "typegpu";

export function useRoot() {
  const { device } = useDevice();

  return useMemo(
    () => (device ? tgpu.initFromDevice({ device }) : null),
    [device]
  );
}
