export const miles=metres=>Number(metres||0)/1609.344;
export const mph=metresPerSecond=>Number(metresPerSecond||0)*2.2369362920544;
export const distanceUS=metres=>{const n=miles(metres);return n.toFixed(n>0&&n<.01?3:n<1?2:1)+' mi';};
export const speedUS=metresPerSecond=>mph(metresPerSecond).toFixed(1)+' mph';
