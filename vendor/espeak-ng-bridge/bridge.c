/*
 * Small C ABI over libespeak-ng 1.52.0 for the Kitten TTS 2 nano/pico/mini
 * non-English front end. Compiled together with espeak-ng by
 * scripts/build-espeak-ng.js into plain JavaScript (no WebAssembly).
 *
 * It does exactly what the Python `phonemizer` package (3.6.0) does through
 * ctypes, so that the phoneme strings match the Python reference:
 *
 *   EspeakAPI.__init__        espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, path, 0)
 *                             (done with the espeak_ng_* calls it makes, see below)
 *   EspeakWrapper.set_voice   espeak_ListVoices(NULL); espeak_SetVoiceByName(identifier)
 *   EspeakWrapper.text_to_phonemes
 *                             loop espeak_TextToPhonemes(&p, espeakCHARS_UTF8, mode)
 *                             until p is NULL, joining the non-empty results with " "
 *
 * The only differences are on error paths: a failed initialisation returns
 * its status instead of calling exit(), and undecodable text stops the loop
 * instead of looping forever.
 *
 * This file is part of the GPL-3.0-or-later espeak-ng build.
 */
#include <stdlib.h>
#include <string.h>

#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>

static char *out_buf = NULL;
static size_t out_cap = 0;
static size_t out_len = 0;

static int out_append(const char *s, size_t n)
{
	if (out_len + n + 1 > out_cap) {
		size_t cap = out_cap ? out_cap : 1024;
		while (out_len + n + 1 > cap)
			cap *= 2;
		char *p = (char *)realloc(out_buf, cap);
		if (p == NULL)
			return -1;
		out_buf = p;
		out_cap = cap;
	}
	memcpy(out_buf + out_len, s, n);
	out_len += n;
	out_buf[out_len] = 0;
	return 0;
}

/* espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, data_path, 0) spelled out
 * with the espeak_ng_* calls it makes, so that a failure (a missing phontab,
 * phonindex, phondata or intonations) is returned instead of calling exit().
 * Returns 0 (ENS_OK) on success, else an espeak_ng_STATUS code. */
int kt_espeak_initialize(const char *data_path)
{
	espeak_ng_ERROR_CONTEXT context = NULL;
	espeak_ng_STATUS status;

	espeak_ng_InitializePath(data_path);
	status = espeak_ng_Initialize(&context);
	if (status != ENS_OK) {
		espeak_ng_ClearErrorContext(&context);
		return (int)status;
	}
	/* espeak_Initialize's AUDIO_OUTPUT_SYNCHRONOUS case; its other step,
	 * option_phoneme_events = options & (...), is 0 for options 0 and
	 * espeak_ng_Initialize already set it to 0. */
	return (int)espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL);
}

/* `identifier` is the voice file relative to espeak-ng-data/lang, as listed
 * by espeak_ListVoices (for example "gmw/de"). Returns 0 on success. */
int kt_espeak_set_voice(const char *identifier)
{
	espeak_ListVoices(NULL);
	return (int)espeak_SetVoiceByName(identifier);
}

/* Returns a NUL-terminated UTF-8 string owned by the bridge, valid until the
 * next call, or NULL when out of memory. */
const char *kt_espeak_text_to_phonemes(const char *text, int phoneme_mode)
{
	const void *ptr = text;
	int first = 1;

	out_len = 0;
	if (out_append("", 0) != 0)
		return NULL;

	while (ptr != NULL) {
		const void *before = ptr;
		const char *ph = espeak_TextToPhonemes(&ptr, espeakCHARS_UTF8, phoneme_mode);
		/* espeak returns NULL without moving the pointer only when the text
		 * cannot be decoded; Python would loop forever there, stop instead. */
		if (ph == NULL && ptr == before)
			break;
		if (ph != NULL && ph[0] != 0) {
			if (!first && out_append(" ", 1) != 0)
				return NULL;
			if (out_append(ph, strlen(ph)) != 0)
				return NULL;
			first = 0;
		}
	}
	return out_buf;
}

const char *kt_espeak_version(void)
{
	return espeak_Info(NULL);
}
