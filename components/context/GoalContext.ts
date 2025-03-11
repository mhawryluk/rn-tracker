import { type Dispatch, type SetStateAction, createContext } from 'react';

export const GoalContext = createContext<
  [number, Dispatch<SetStateAction<number>>]
>([10, () => {}]);
