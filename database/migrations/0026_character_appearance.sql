-- TIBIAGAME_V36_95_AUTHORITATIVE_APPEARANCE
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS appearance_json TEXT NOT NULL DEFAULT
    $json${"body":"body_02","head":"head_01","face":"face_01","hair":"hair_02","facialHair":"beard_01","torso":"torso_02","legs":"legs_02","feet":"feet_02","skinTone":"skin_warm","hairColor":"hair_brown","torsoColor":"cloth_burgundy","legsColor":"cloth_charcoal","feetColor":"leather_brown"}$json$;

UPDATE characters
SET appearance_json = CASE outfit
    WHEN 'mage' THEN
        $json${"body":"body_01","head":"head_03","face":"face_03","hair":"hair_04","facialHair":null,"torso":"torso_03","legs":"legs_03","feet":"feet_01","skinTone":"skin_light","hairColor":"hair_black","torsoColor":"cloth_violet","legsColor":"cloth_navy","feetColor":"leather_dark"}$json$
    WHEN 'ranger' THEN
        $json${"body":"body_01","head":"head_02","face":"face_02","hair":"hair_03","facialHair":"beard_02","torso":"torso_01","legs":"legs_01","feet":"feet_02","skinTone":"skin_tan","hairColor":"hair_auburn","torsoColor":"cloth_forest","legsColor":"cloth_earth","feetColor":"leather_brown"}$json$
    WHEN 'rogue' THEN
        $json${"body":"body_01","head":"head_02","face":"face_02","hair":"hair_01","facialHair":null,"torso":"torso_02","legs":"legs_03","feet":"feet_01","skinTone":"skin_warm","hairColor":"hair_black","torsoColor":"cloth_charcoal","legsColor":"cloth_charcoal","feetColor":"leather_dark"}$json$
    ELSE
        $json${"body":"body_02","head":"head_01","face":"face_01","hair":"hair_02","facialHair":"beard_01","torso":"torso_02","legs":"legs_02","feet":"feet_02","skinTone":"skin_warm","hairColor":"hair_brown","torsoColor":"cloth_burgundy","legsColor":"cloth_charcoal","feetColor":"leather_brown"}$json$
END;
