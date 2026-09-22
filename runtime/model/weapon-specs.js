// Physical asset specifications. No renderer or simulation dependencies.
export const SMALL_AC200 = Object.freeze({
  id: 'small-ac200', hardpointSize: 'small', calibreMm: 200,
  mountDiameterM: 8.36, metresPerAssetUnit: 1,
  shotInterval: .18, recoilM: .28, recoilDuration: .24,
  minElevation: -8 * Math.PI / 180, maxElevation: 40 * Math.PI / 180,
  nodes: Object.freeze({yaw:'Yaw_Pivot',pitch:'Pitch_Pivot',
    recoil:['Recoil_L','Recoil_R'],muzzles:['MUZZLE_L','MUZZLE_R']})
});
