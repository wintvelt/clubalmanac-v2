import { describe, expect, it } from "vitest";
import { as, filmsApi, filmsInternal, newT, parseS3Link, seedFilmsWorld, useFilmsEnv, type R } from "./_films";

// WP21 fix-ronde, audit-bevinding: een vaste uitkomst voor de handtekening.
// expectValidSignature (in _films.ts) rekent de handtekening na vanaf het pad
// in de link zelf. Codeert de code het pad verkeerd, dan klopt de link nog
// steeds "met zichzelf", maar weigert S3 hem. Deze test pint de uitkomst van
// een signer die niet uit deze repo komt.
//
// Hoe gemaakt (2026-11-15), met de AWS-SDK-signer uit node_modules:
//   - `@smithy/signature-v4` (SignatureV4, service "s3", uriEscapePath false,
//     zoals de S3-client), het pad per segment gecodeerd met `escapeUri` uit
//     `@smithy/core/protocols`;
//   - de AWS-voorbeeldsleutels uit de documentatie (AKIAIOSFODNN7EXAMPLE),
//     regio eu-central-1, bucket "examplebucket", host
//     `examplebucket.s3.eu-central-1.amazonaws.com`;
//   - query `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD`, payload-hash
//     UNSIGNED-PAYLOAD, alleen `host` ondertekend;
//   - tijdstip 2026-11-15T12:00:00Z (FIXED_NOW), geldig 10800 s.
// Dezelfde SDK-opzet geeft voor het voorbeeld uit de AWS-documentatie
// (examplebucket/test.txt, us-east-1, 20130524T000000Z, 86400 s) precies de
// gedocumenteerde handtekening aeeed9bb…f604d404. Dat voorbeeld zelf kan hier
// niet: de documentatie gebruikt de host zonder regio en zet geen
// X-Amz-Content-Sha256 in de query.
//
// Gemuteerd en rood gezien (convex/lib/s3Presign.ts): ook de `/` in het pad
// coderen, en encodeURIComponent zonder de extra codering van !'()*.

const AWS_EXAMPLE = {
  FILMS_S3_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  FILMS_S3_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  FILMS_S3_REGION: "eu-central-1",
  FILMS_S3_BUCKET: "examplebucket",
};

const CASES = [
  {
    title: "Vast antwoord: map en haakjes",
    key: "films/a (b).mp4",
    pathname: "/films/a%20%28b%29.mp4",
    signature: "28cf6ceac50e9e4859046c54e43ec07e76d57e81581be86638e174d16c339c5e",
  },
  {
    title: "Vast antwoord: apostrof, uitroepteken, sterretje",
    key: "covers/Proef B's film!*.png",
    pathname: "/covers/Proef%20B%27s%20film%21%2A.png",
    signature: "c8dbe10e25d21227c6e0f664c7410d4d79c01f50bf66a1e123ffa96291d6238f",
  },
] as const;

useFilmsEnv();

describe("handtekening: vaste uitkomst van de AWS-SDK-signer", () => {
  for (const c of CASES) {
    it(`${c.key} → exact pad en exacte handtekening`, async () => {
      const t = newT();
      const w = await seedFilmsWorld(t);
      await t.mutation(filmsInternal.replaceAll, {
        items: [{ groupId: w.groups.blob, kind: "film", title: c.title, year: 2020, videoKey: c.key }],
      });
      for (const [k, v] of Object.entries(AWS_EXAMPLE)) process.env[k] = v;
      const list = (await as.alice(t).query(filmsApi.list, {})) as R[];
      const filmId = list.find((f) => f.title === c.title)?._id as string;
      expect(filmId).toBeTruthy();

      const { url } = (await as.alice(t).action(filmsApi.videoUrl, { filmId })) as { url: string };
      const link = parseS3Link(url);

      expect(link.url.host).toBe("examplebucket.s3.eu-central-1.amazonaws.com");
      // Het pad zoals het in de link staat, niet gedecodeerd: daar zit de fout.
      expect(url.slice(`https://${link.url.host}`.length).split("?")[0]).toBe(c.pathname);
      const { "X-Amz-Signature": signature, ...rest } = link.params;
      expect(rest).toEqual({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
        "X-Amz-Credential": "AKIAIOSFODNN7EXAMPLE/20261115/eu-central-1/s3/aws4_request",
        "X-Amz-Date": "20261115T120000Z",
        "X-Amz-Expires": "10800",
        "X-Amz-SignedHeaders": "host",
      });
      expect(signature).toBe(c.signature);
    });
  }
});
