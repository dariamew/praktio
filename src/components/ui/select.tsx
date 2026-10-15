import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check,ChevronDown,ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({className,children,...props}:React.ComponentProps<typeof SelectPrimitive.Trigger>) {
 return <SelectPrimitive.Trigger data-slot="select-trigger" className={cn('inline-flex items-center justify-between gap-3 rounded-md border bg-background px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50',className)} {...props}>{children}<SelectPrimitive.Icon asChild><ChevronDown className="size-4 opacity-60"/></SelectPrimitive.Icon></SelectPrimitive.Trigger>;
}
function SelectContent({className,children,position='popper',...props}:React.ComponentProps<typeof SelectPrimitive.Content>) {
 return <SelectPrimitive.Portal><SelectPrimitive.Content data-slot="select-content" position={position} sideOffset={6} align="end" collisionPadding={12} className={cn('relative z-50 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',className)} {...props}><SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1"><ChevronUp className="size-4"/></SelectPrimitive.ScrollUpButton><SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport><SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1"><ChevronDown className="size-4"/></SelectPrimitive.ScrollDownButton></SelectPrimitive.Content></SelectPrimitive.Portal>;
}
function SelectItem({className,children,...props}:React.ComponentProps<typeof SelectPrimitive.Item>) {
 return <SelectPrimitive.Item data-slot="select-item" className={cn('relative flex w-full cursor-default items-center rounded-sm py-2 pr-8 pl-3 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',className)} {...props}><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText><span className="absolute right-2 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-4"/></SelectPrimitive.ItemIndicator></span></SelectPrimitive.Item>;
}
export { Select,SelectValue,SelectTrigger,SelectContent,SelectItem };
