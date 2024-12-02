import { createContext } from "react";
import { ExperimentalTgpuRoot } from "typegpu/experimental";

export const RootContext = createContext<
  ExperimentalTgpuRoot | null
>(null);
