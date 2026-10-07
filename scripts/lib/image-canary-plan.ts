import {CHARACTER_PRESETS} from '../../src/lib/characters';
import {resolveCharacterAppearance} from '../../src/lib/character-appearance';
export const IMAGE_CANARY_REQUESTS=8;
export function personalImageCanaryCases(){
 if(CHARACTER_PRESETS.length!==IMAGE_CANARY_REQUESTS)throw new Error('Image canary requires the eight configured personal characters');
 return CHARACTER_PRESETS.map(character=>{
  const appearance=resolveCharacterAppearance(character.key,'normal');
  return {characterKey:character.key,referencePath:appearance.referenceImage,mediaType:'image/png' as const,prompt:'Create a fully clothed casual illustration of this same adult character in a softly lit cafe. Preserve the original identity, outfit and illustration style.'};
 });
}
