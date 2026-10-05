export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        BackButton: {
          hide(): void;
          onClick(callback: () => void): void;
          show(): void;
        };
        HapticFeedback: {
          impactOccurred(style: "light"): void;
        };
        expand(): void;
        initData?: string;
        ready(): void;
        showConfirm(message: string, callback: (confirmed: boolean) => void): void;
      };
    };
  }
}
