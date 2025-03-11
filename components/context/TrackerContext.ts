import { type Dispatch, type SetStateAction, createContext } from 'react';

export const TrackerContext = createContext<
  [number[], Dispatch<SetStateAction<number[]>>]
>([[], () => {}]);
