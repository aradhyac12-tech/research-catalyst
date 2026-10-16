import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Soft, rounded buttons with a short eased transition. Hover lifts the shadow slightly, press scales down a hair,
// so every click gets immediate feedback without any heavy animation (100-200ms is the range that feels instant but visible).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[15px] font-semibold tracking-[-0.003em] cursor-pointer select-none touch-manipulation transition-[background-color,box-shadow,border-color,color,transform] duration-200 ease-premium active:translate-y-px active:scale-[0.985] active:duration-75 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-button hover:bg-primary/92 hover:shadow-button-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-button hover:bg-destructive/92 hover:shadow-soft",
        positive: "bg-positive text-white shadow-button hover:bg-positive/92 hover:shadow-soft",
        outline: "border border-border bg-background text-foreground shadow-soft hover:border-foreground/35 hover:bg-wash",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground",
        link: "font-medium text-primary underline underline-offset-4 hover:decoration-2",
      },
      size: { default: "h-10 px-4", sm: "h-9 px-3.5 text-sm", lg: "h-12 px-6 text-base", icon: "h-10 w-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
