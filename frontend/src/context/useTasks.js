import { useContext } from 'react';
import { TasksContext } from './TasksState';
export const useTasks = () => useContext(TasksContext);
