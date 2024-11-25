import { createContext, Dispatch, SetStateAction } from "react";

export const TrackerContext = createContext<
  [number[], Dispatch<SetStateAction<number[]>>]
>([[], () => {}]);
