import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium leading-5", {
  variants: {
    variant: {
      default: "bg-positive-soft text-positive ring-1 ring-inset ring-positive/20",
      secondary: "bg-wash text-foreground ring-1 ring-inset ring-foreground/10",
      caution: "bg-caution-soft text-caution ring-1 ring-inset ring-caution/25",
      destructive: "bg-critical-soft text-destructive ring-1 ring-inset ring-destructive/20",
      outline: "border border-border text-foreground",
    },
  },
  defaultVariants: { variant: "secondary" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
function Badge({ className, variant, ...props }: BadgeProps) { return <span className={cn(badgeVariants({ variant }), className)} {...props} />; }
export { Badge, badgeVariants };
