export const createTripRepository=local=>({list:()=>{const d=local.snapshot();return d.trip?[d.trip]:[]},active:()=>local.snapshot().trip});
