// Inverse of Three r185's ACESFilmicToneMapping, in linear sRGB. Painted sprites
// need their authored channel ratios at the output, not another filmic highlight
// compression after lighting. Keep a little daylight headroom for the scene grade.
// When changing Three or the output transform, run test/fixtures/townSpriteColor.html.
export const authoredSpriteColorShader = /* glsl */`
  uniform float townExposure;
  uniform float townSpriteWhite;
  vec3 townSpriteRadiance(vec3 color) {
    const mat3 inputInverse = mat3(
      1.76474097, -.14702785, -.03633683,
      -.67577768, 1.16025151, -.16243644,
      -.08896329, -.01322366, 1.19877327
    );
    const mat3 outputInverse = mat3(
      .64303825, .05926869, .00596190,
      .31118675, .93143649, .06392902,
      .04577546, .00929492, .93011838
    );
    vec3 mapped = outputInverse * (clamp(color, 0., 1.) * townSpriteWhite);
    vec3 a = 1. - .983729 * mapped;
    vec3 b = .0245786 - .4329510 * mapped;
    vec3 c = -.000090537 - .238081 * mapped;
    vec3 fitted = (-b + sqrt(max(b*b - 4.*a*c, vec3(0.)))) / (2.*a);
    return max(inputInverse * fitted, vec3(0.)) * (.6 / max(townExposure, .01));
  }
`
