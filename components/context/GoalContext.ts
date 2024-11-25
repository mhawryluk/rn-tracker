import { createContext, Dispatch, SetStateAction } from "react";

export const GoalContext = createContext<
  [number, Dispatch<SetStateAction<number>>]
>([10, () => {}]);
