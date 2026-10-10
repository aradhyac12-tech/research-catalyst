import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium leading-5", {
  variants: {
    variant: {
      default: "bg-positive-soft text-positive",
      secondary: "bg-wash text-foreground",
      caution: "bg-caution-soft text-caution",
      destructive: "bg-critical-soft text-destructive",
      outline: "border border-border text-foreground",
    },
  },
  defaultVariants: { variant: "secondary" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
function Badge({ className, variant, ...props }: BadgeProps) { return <span className={cn(badgeVariants({ variant }), className)} {...props} />; }
export { Badge, badgeVariants };
