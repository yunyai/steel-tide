/** Presentation-only, evenly distributed chords. Consecutive cuts cannot follow one clustered teleport path. */
export function stepperSlashLayout(index:number):{ax:number;az:number;bx:number;bz:number;cx:number;cz:number} {
  const angle=index*2.399963229728653;
  const offset=(((index*7)%17)/16-.5)*1400;
  const half=Math.sqrt(1000000-offset*offset),dx=Math.cos(angle),dz=Math.sin(angle),px=-dz*offset,pz=dx*offset;
  const bend=Math.sin(index*1.7)*80;
  return{ax:px-dx*half,az:pz-dz*half,bx:px+dx*half,bz:pz+dz*half,cx:px-dz*bend,cz:pz+dx*bend};
}
