'use client';

import React from 'react';
import { PieChart, Pie, Cell } from 'recharts';

interface AllocationItem {
  name: string;
  value: number;
  color: string;
}

interface AllocationDonutProps {
  allocation: AllocationItem[];
}

function AllocationDonut({ allocation }: AllocationDonutProps) {
  return (
    <PieChart width={120} height={120}>
      <Pie
        data={allocation}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        innerRadius={30}
        outerRadius={50}
        strokeWidth={0}
      >
        {allocation.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.color} />
        ))}
      </Pie>
    </PieChart>
  );
}

export default React.memo(AllocationDonut);
