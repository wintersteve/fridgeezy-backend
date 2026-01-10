import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createStorage } from "@/shared/local-storage";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface StepExplanationState {
  // Existing fields
  visible: boolean;
  stepNumber: number | null;
  instruction: string | null;
  recipeId: string | null;

  // New chat fields
  messages: Record<string, Message[]>; // keyed by `${recipeId}-${stepNumber}`
}

export interface StepExplanationActions {
  // Existing actions
  toggle: (visible?: boolean) => void;
  setStep: (recipeId: string, stepNumber: number, instruction: string) => void;
  reset: () => void;

  // New chat actions
  addMessage: (
    recipeId: string,
    stepNumber: number,
    message: Omit<Message, "id">,
  ) => void;
  clearMessages: (recipeId: string, stepNumber: number) => void;
  appendToStreamingMessage: (
    recipeId: string,
    stepNumber: number,
    chunk: string,
  ) => void;
  completeStreamingMessage: (recipeId: string, stepNumber: number) => void;
}

const initialState: StepExplanationState = {
  visible: false,
  stepNumber: null,
  instruction: null,
  recipeId: null,
  messages: {},
};

export const useStepExplanationStore = create<
  StepExplanationState & StepExplanationActions
>()(
  persist(
    (set) => ({
      ...initialState,

      toggle: (visible) =>
        set((state) => ({ visible: visible ?? !state.visible })),

      setStep: (recipeId, stepNumber, instruction) =>
        set({ visible: true, recipeId, stepNumber, instruction }),

      reset: () =>
        set({
          visible: false,
          stepNumber: null,
          instruction: null,
          recipeId: null,
        }),

      addMessage: (recipeId, stepNumber, message) => {
        const key = `${recipeId}-${stepNumber}`;
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        set((state) => ({
          messages: {
            ...state.messages,
            [key]: [...(state.messages[key] || []), { ...message, id }],
          },
        }));
      },

      clearMessages: (recipeId, stepNumber) => {
        const key = `${recipeId}-${stepNumber}`;
        set((state) => {
          const { [key]: _, ...rest } = state.messages;
          return { messages: rest };
        });
      },

      appendToStreamingMessage: (recipeId, stepNumber, chunk) => {
        const key = `${recipeId}-${stepNumber}`;
        set((state) => {
          const messages = state.messages[key] || [];
          const lastMessage = messages[messages.length - 1];

          if (
            !lastMessage ||
            lastMessage.role !== "assistant" ||
            !lastMessage.isStreaming
          ) {
            return state;
          }

          return {
            messages: {
              ...state.messages,
              [key]: [
                ...messages.slice(0, -1),
                { ...lastMessage, content: lastMessage.content + chunk },
              ],
            },
          };
        });
      },

      completeStreamingMessage: (recipeId, stepNumber) => {
        const key = `${recipeId}-${stepNumber}`;
        set((state) => {
          const messages = state.messages[key] || [];
          const lastMessage = messages[messages.length - 1];

          if (!lastMessage || !lastMessage.isStreaming) {
            return state;
          }

          return {
            messages: {
              ...state.messages,
              [key]: [
                ...messages.slice(0, -1),
                { ...lastMessage, isStreaming: false },
              ],
            },
          };
        });
      },
    }),
    {
      name: "STEP_EXPLANATION_CHAT_STORE",
      storage: createJSONStorage(createStorage),
      partialize: (state) => ({
        messages: state.messages,
      }),
    },
  ),
);
