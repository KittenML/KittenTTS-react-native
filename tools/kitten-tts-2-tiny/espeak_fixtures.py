#!/usr/bin/env python
"""Write tests/fixtures/kitten-tts-2-tiny-espeak.json: the Python kittenml phonemes for the espeak languages.

For every language and phonemizer version that goes through espeak-ng, each test text is run through
kittenml's own code, exactly what LangG2P does before its vocab filtering:

    phonemize_vN.phonemize_lang(phonemize_vN.get_g2p(lang), text, lang)

tests/kitten-tts-2-tiny-espeak.test.js checks that src/tiny/frontend/espeak/EspeakG2P.ts gives the same strings.

Run with the reference environment (kittenml from KittenML/KittenTTS main, misaki 0.9.4, phonemizer 3.6.0,
espeakng_loader 0.2.4 = espeak-ng 1.52.0):

    python -I tools/kitten-tts-2-tiny/espeak_fixtures.py [--out FILE] [--check-state]

--check-state also phonemizes the texts in reverse order, and every 7th text in a fresh espeak instance, and
reports any text whose phonemes depend on what was phonemized before it (espeak keeps some state between calls).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "kitten-tts-2-tiny-espeak.json"

V1_LANGS = ["de", "es", "it", "pt", "ru", "hi", "fr"]
V2_LANGS = V1_LANGS + ["da", "fi", "nl", "sv", "sw", "tr", "ko"]

# Inputs every language gets: punctuation-only, empty-ish, numbers, odd whitespace.
GENERIC = [
    "", "   ", ".", "...", "…", "?!", "—", '""', "()", "(  )", "1", "7.", "2024", "3,14", "1.5",
    "100%", "OK", "« »", "(a)", "e.g. (see: p. 3)", "x\ny", "a\tb", "-", "'", "1–2",
    "Line one.\nLine two.", "  padded  ", "A (B) C", "[note] {x}", "“quoted”",
    # odd whitespace (Python's str.strip / \s differ from JavaScript's), separators, nesting
    "\u00a0Hallo\u00a0Welt\u00a0", "\ufeffstart", "a\u0085b", "a\u2028b", "a\u001cb", "\t\ttabs\t",
    "\r\nwindows\r\nline", "snake_case_word and __init__", "x^2 + y^2", "well-known -- dash --- triple",
    "1.000,50 and 1,000.50 and .5 and 5. and 1,.2", "v2.0.1", "!!!???...,,,;;;", "((nested (deep) parens))",
    '"quote (paren) quote"', "[a] (b) {c} «d» “e” ‹f› „g“ ‘h’",
    "word(attached)word", "end with comma,", "\U0001f600 emoji \U0001f44d\U0001f3fd", "Supercalifragilisticexpialidocious",
    "N.A.S.A. U.S.A. e.g. i.e.", "50€ $10 £5 ¥100 ₹20", "10:30–11:45", "+49 (0)30 1234567",
    "#hashtag @mention https://example.com/path?q=1", "Ǆ ǅ ǆ ﬁ İ ı",
    "ℕ ① ½ ² ㎏", "(«nested» “quotes”)",
    "α-Tocopherol, β = 0,5 and π ≈ 3,14159", "Ελλάδα",
]

# Words in a script espeak reads with another language's translator, which then opens that language's dictionary
# (hi_dict, ko_dict, ru_dict, de_dict here). EspeakG2P matches them when those files are given too; the
# one-language-at-a-time test skips them (marked "other_script").
OTHER_SCRIPT = [
    "Seoul (서울) and Delhi (दिल्ली)",
    "Москва", "Strauß", "ẞ",
]

SENTENCES = {
    "de": """
Guten Morgen! Wie geht es Ihnen heute?
Ich habe gestern 3 Äpfel und 12 Birnen gekauft.
Das Treffen beginnt um 14:30 Uhr im Raum 2.15.
Im Jahr 1989 fiel die Berliner Mauer.
Das kostet 19,99 € – also fast 20 Euro.
Er sagte: „Ich komme morgen wieder.“
Die Straße (eigentlich eine Gasse) war sehr schmal.
z. B. Herr Dr. Müller, Frau Prof. Schmidt usw.
Wir treffen uns am 3. Oktober 2025.
Achtung; das ist wichtig: Bitte nicht berühren!
Ich weiß nicht... vielleicht morgen?
Das Meeting war ein echtes Highlight für das ganze Team.
Lass uns ein Selfie machen und es auf Instagram posten.
Die Bevölkerung wuchs auf 83.200.000 Menschen.
Ja.
Nein!
Hm?
Fußball ist in Deutschland sehr beliebt.
Die Temperatur liegt bei -5 Grad.
Er wohnt in der Goethestraße 7a, 10115 Berlin.
Ein Kilogramm Kartoffeln kostet 2,50 Euro.
Das Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz wurde abgeschafft.
Kannst du mir bitte das Salz reichen?
„Hallo“, rief sie, „wo bist du?“
Die Firma (gegründet 1886) hat ihren Sitz in Stuttgart.
Wir brauchen Brot, Milch, Eier und Käse.
Es ist 50 % billiger als letztes Jahr!
Mein Handy hat keinen Akku mehr — so ein Mist.
Der Zug nach München fährt um 8:05 Uhr ab.
Ich habe die E-Mail an info@beispiel.de geschickt.
Das 21. Jahrhundert begann im Jahr 2001.
Sie las das Buch »Der Prozess« von Kafka.
Über den Wolken muss die Freiheit wohl grenzenlos sein.
Ach so, ich verstehe.
Die Kinder spielten im Garten, während die Eltern grillten.
Der Computer ist kaputt, und das Software-Update hilft nicht.
Zwei Drittel der Befragten sagten Nein.
Wie viel kostet das? 5 oder 50 Euro?
Das Wetter ist heute schön; morgen soll es regnen.
Sie wohnt seit dem 1. Januar in Köln (genauer: in Ehrenfeld).
""",
    "es": """
¡Hola! ¿Cómo estás hoy?
Compré 3 manzanas y 12 naranjas en el mercado.
La reunión empieza a las 10:45 de la mañana.
En 1492 Colón llegó a América.
El libro cuesta 15,50 € en la librería.
Ella dijo: «No quiero ir a la fiesta».
Mi hermano (el mayor) vive en Barcelona.
El Sr. García y la Sra. López llegaron tarde.
Nos vemos el 25 de diciembre de 2024.
Atención: el museo cierra los lunes; abre de martes a domingo.
No sé... quizá mañana.
Vamos a ver el partido de fútbol en el estadio.
Me encanta el rock and roll y el jazz.
Hice un post en Facebook sobre mi weekend.
Sí.
¡No!
¿Qué?
La población de México supera los 126.000.000 de habitantes.
Hace 30 °C y mucho calor.
El 50 % de los estudiantes aprobó el examen.
El niño corría por el parque con su perro.
¿Dónde está la estación de tren más cercana?
Quiero un café con leche, por favor.
El cumpleaños de Ana es el 1 de mayo.
Llámame al 912 345 678 cuando llegues.
La película —que duró tres horas— fue aburrida.
Ellos trabajan en una empresa de software.
El agua hierve a 100 grados.
¡Qué día tan bonito hace hoy!
Necesito pan, leche, huevos y queso.
Siglo XXI: la era digital.
Envié el correo a info@ejemplo.es ayer.
El tren sale a las 8 y media.
Pedro, ¿vienes o no?
Estoy cansado; me voy a dormir.
Ese restaurante es muy caro: 80 dólares por persona.
Ella leyó "Cien años de soledad" en dos días.
La ONU y la UE firmaron el acuerdo.
El pingüino comió cigüeñas en la Antártida.
""",
    "it": """
Ciao! Come stai oggi?
Ho comprato 3 mele e 12 pere al mercato.
La riunione inizia alle 9:15.
Nel 1861 l'Italia fu unificata.
Il biglietto costa 7,50 €.
Lui disse: «Arrivo subito».
Mia sorella (la più piccola) studia a Bologna.
Il dott. Rossi e la sig.ra Bianchi sono arrivati.
Ci vediamo il 2 giugno 2026.
Attenzione: il negozio è chiuso la domenica; apre il lunedì.
Non lo so... forse domani.
Abbiamo guardato la partita di calcio allo stadio.
Facciamo un brainstorming durante il meeting.
Sì.
No!
Perché?
La popolazione italiana è di circa 59.000.000 di persone.
Oggi ci sono 35 gradi.
Il 20 % degli studenti è assente.
Gli spaghetti alla carbonara sono buonissimi.
Dov'è la stazione dei treni?
Vorrei un caffè, per favore.
Chiamami al numero 06 1234 5678.
Il film — lunghissimo — è finito tardi.
Lavoro in un'azienda che produce software.
Che bella giornata!
Mi servono pane, latte, uova e formaggio.
Il XX secolo è stato pieno di cambiamenti.
Ho inviato una e-mail a info@esempio.it.
Il treno parte alle otto e mezza.
Marco, vieni con noi?
Sono stanco; vado a dormire.
Quel ristorante è caro: 60 euro a testa.
Ha letto "Il nome della rosa" in una settimana.
L'UE ha approvato la legge.
Gli uccelli volano sopra il lago.
È l'una e un quarto.
Questo è il weekend più bello dell'anno.
Perché non vieni (anche solo per un'ora)?
""",
    "pt": """
Olá! Tudo bem com você?
Comprei 3 maçãs e 12 laranjas na feira.
A reunião começa às 14:30.
Em 1500 os portugueses chegaram ao Brasil.
O ingresso custa R$ 45,90.
Ela disse: «Vou chegar tarde».
Meu irmão (o mais velho) mora em São Paulo.
O Sr. Silva e a Dra. Souza chegaram cedo.
Nos vemos no dia 7 de setembro de 2025.
Atenção: a loja fecha aos domingos; abre de segunda a sábado.
Não sei... talvez amanhã.
Vamos assistir ao jogo de futebol no estádio.
Fiz um post no Instagram sobre o show.
Sim.
Não!
O quê?
O Brasil tem mais de 203.000.000 de habitantes.
Hoje está fazendo 32 graus.
Cerca de 40 % dos alunos faltaram.
A criança brincava no parque com o cachorro.
Onde fica a estação de metrô?
Quero um cafezinho, por favor.
Me liga no (11) 98765-4321.
O filme — muito longo — terminou à meia-noite.
Eles trabalham numa empresa de tecnologia.
Que dia lindo!
Preciso de pão, leite, ovos e queijo.
No século XXI tudo mudou.
Mandei um e-mail para contato@exemplo.com.br.
O ônibus sai às oito e meia.
João, você vem ou não?
Estou cansado; vou dormir.
Esse restaurante é caro: 120 reais por pessoa.
Ela leu "Dom Casmurro" em dois dias.
A ONU publicou o relatório.
Coração, pão, mãe e irmã.
Saudade é uma palavra difícil de traduzir.
O site está fora do ar, mas o app funciona.
Ele chegou (finalmente!) às 22h.
""",
    "ru": """
Привет! Как дела?
Я купил 3 яблока и 12 груш на рынке.
Встреча начинается в 15:00.
В 1961 году Гагарин полетел в космос.
Билет стоит 1 500 рублей.
Она сказала: «Я приду завтра».
Мой брат (старший) живёт в Москве.
Мы встретимся 9 мая 2025 года.
Внимание: магазин закрыт по воскресеньям; открыт с понедельника.
Не знаю... может быть, завтра.
Мы смотрели футбольный матч на стадионе.
Я отправил письмо на e-mail вчера.
Этот iPhone стоит слишком дорого.
Да.
Нет!
Что?
Население России — около 146 000 000 человек.
Сегодня на улице -15 градусов.
Около 30 % студентов не пришли.
Дети играли во дворе, пока родители готовили ужин.
Где находится ближайшая станция метро?
Мне, пожалуйста, чашку чая.
Позвони мне по номеру 8 (495) 123-45-67.
Фильм — очень длинный — закончился поздно.
Они работают в IT-компании.
Какой прекрасный день!
Мне нужны хлеб, молоко, яйца и сыр.
XXI век — век технологий.
Поезд отправляется в 8:30 утра.
Иван, ты идёшь или нет?
Я устал; пойду спать.
Этот ресторан дорогой: 3000 рублей на человека.
Она прочитала «Войну и мир» за месяц.
т. е. и т. д.
Ёлка стоит в углу комнаты.
Щука плавает в реке.
Съешь же ещё этих мягких французских булок, да выпей чаю.
Москва — столица России.
Мы были в Санкт-Петербурге (летом 2019 года).
""",
    "hi": """
नमस्ते! आप कैसे हैं?
मैंने बाज़ार से 3 सेब और 12 केले खरीदे।
बैठक दोपहर 2:30 बजे शुरू होगी।
भारत को 1947 में आज़ादी मिली।
इस किताब की कीमत ₹250 है।
उसने कहा, "मैं कल आऊँगा।"
मेरा भाई (सबसे बड़ा) दिल्ली में रहता है।
हम 15 अगस्त 2025 को मिलेंगे।
ध्यान दें: दुकान रविवार को बंद रहती है; सोमवार को खुलती है।
मुझे नहीं पता... शायद कल।
हमने स्टेडियम में क्रिकेट मैच देखा।
मैंने अपना laptop घर पर छोड़ दिया।
हाँ।
नहीं!
क्या?
भारत की जनसंख्या 140 करोड़ से अधिक है।
आज तापमान 45 डिग्री है।
लगभग 60 % छात्र अनुपस्थित थे।
बच्चे पेड़ के नीचे खेल रहे थे।
वह सड़क पर दौड़ रहा था।
उसने पढ़ाई पूरी की और नौकरी ढूँढ़ने लगा।
गाड़ी बहुत तेज़ चल रही थी।
भीड़ में कोई खो गया।
कृपया मुझे एक कप चाय दीजिए।
मुझे 9876543210 पर फ़ोन करें।
फ़िल्म — बहुत लंबी — देर से खत्म हुई।
क्या सुंदर दिन है!
मुझे रोटी, दूध, अंडे और पनीर चाहिए।
ट्रेन सुबह 8 बजे चलती है॥
राम, तुम आ रहे हो या नहीं?
मैं थक गया हूँ; सोने जा रहा हूँ।
पहला वाक्य। दूसरा वाक्य। तीसरा वाक्य।
उसने "गोदान" उपन्यास पढ़ा।
बड़ा घर, छोटा बगीचा।
पहाड़ों पर बर्फ़ गिर रही है।
डॉ. शर्मा अस्पताल में हैं।
मेरा जन्म 1995 में हुआ था।
67 लोग आए थे।
हिंदी भारत की राजभाषा है।
वह भीड़। फिर घर गया।
""",
    "fr": """
Bonjour ! Comment allez-vous aujourd'hui ?
J'ai acheté 3 pommes et 12 poires au marché.
La réunion commence à 14 h 30.
En 1789, la Révolution française a commencé.
Le billet coûte 12,50 €.
Elle a dit : « Je viendrai demain. »
Mon frère (l'aîné) habite à Lyon.
M. Dupont et Mme Martin sont arrivés.
Rendez-vous le 14 juillet 2025.
Attention : le magasin est fermé le dimanche ; il ouvre le lundi.
Je ne sais pas... peut-être demain.
Nous avons regardé le match de football au stade.
J'aime le football et le week-end.
Oui.
Non !
Quoi ?
La France compte environ 68 000 000 d'habitants.
Il fait 25 °C aujourd'hui.
Environ 30 % des élèves étaient absents.
Les enfants jouaient dans le jardin pendant que les parents cuisinaient.
Où se trouve la gare la plus proche ?
Un café, s'il vous plaît.
Appelle-moi au 01 23 45 67 89.
Le film — très long — s'est terminé tard.
Ils travaillent dans une start-up.
Quelle belle journée !
J'ai besoin de pain, de lait, d'œufs et de fromage.
Le XXIe siècle a commencé en 2001.
J'ai envoyé un e-mail à contact@exemple.fr.
Le train part à huit heures et demie.
Pierre, tu viens ou pas ?
Je suis fatigué ; je vais dormir.
Ce restaurant est cher : 80 euros par personne.
Elle a lu « Les Misérables » en un mois.
Les amis arrivent ; les enfants aussi.
C'est un grand homme.
Ils ont onze ans.
Il y a des oiseaux dans les arbres.
Le 1er janvier, c'est le jour de l'an.
Les (vieux) amis sont là.
Vraiment\u202f?
Attention\u202f: danger\u202f!
Prix\u2009: 10\u2009€
""",
    "da": """
Hej! Hvordan har du det i dag?
Jeg købte 3 æbler og 12 pærer på markedet.
Mødet starter kl. 14.30.
I 1849 fik Danmark en grundlov.
Billetten koster 89,50 kr.
Hun sagde: »Jeg kommer i morgen.«
Min bror (den ældste) bor i Aarhus.
Vi ses den 5. juni 2025.
Bemærk: butikken er lukket om søndagen; den åbner mandag.
Jeg ved det ikke... måske i morgen.
Vi så fodboldkampen på stadion.
Jeg har sendt en e-mail til min chef.
Ja.
Nej!
Hvad?
Danmark har omkring 5.900.000 indbyggere.
Det er 20 grader i dag.
Cirka 25 % af eleverne var fraværende.
Børnene legede i haven, mens forældrene lavede mad.
Hvor ligger den nærmeste togstation?
En kop kaffe, tak.
Ring til mig på 12 34 56 78.
Filmen — meget lang — sluttede sent.
De arbejder i et softwarefirma.
Sikke en dejlig dag!
Jeg skal bruge brød, mælk, æg og ost.
Toget kører kl. 8.15.
Peter, kommer du eller ej?
Jeg er træt; jeg går i seng.
Den restaurant er dyr: 400 kroner per person.
Rødgrød med fløde.
Hun læste "Den grimme ælling" af H.C. Andersen.
Det var en rigtig hyggelig weekend.
København er Danmarks hovedstad.
Øen ligger ude i havet.
Vi spiser smørrebrød til frokost.
Han har boet her siden år 2000.
Undskyld, hvad sagde du?
""",
    "fi": """
Hei! Mitä kuuluu?
Ostin torilta 3 omenaa ja 12 päärynää.
Kokous alkaa kello 14.30.
Suomi itsenäistyi vuonna 1917.
Lippu maksaa 12,50 euroa.
Hän sanoi: ”Tulen huomenna.”
Veljeni (vanhin) asuu Tampereella.
Nähdään 6. joulukuuta 2025.
Huomio: kauppa on suljettu sunnuntaisin; se avataan maanantaina.
En tiedä... ehkä huomenna.
Katsoimme jalkapallo-ottelun stadionilla.
Lähetin sähköpostin pomolleni.
Kyllä.
Ei!
Mitä?
Suomessa on noin 5 600 000 asukasta.
Tänään on -20 astetta pakkasta.
Noin 15 % oppilaista oli poissa.
Lapset leikkivät pihalla, kun vanhemmat laittoivat ruokaa.
Missä on lähin rautatieasema?
Kuppi kahvia, kiitos.
Soita minulle numeroon 040 123 4567.
Elokuva — hyvin pitkä — loppui myöhään.
He työskentelevät ohjelmistoyrityksessä.
Mikä kaunis päivä!
Tarvitsen leipää, maitoa, munia ja juustoa.
Juna lähtee kello 8.05.
Matti, tuletko vai et?
Olen väsynyt; menen nukkumaan.
Ravintola on kallis: 70 euroa hengeltä.
Hän luki kirjan "Tuntematon sotilas" viikossa.
Sauna on suomalaisten lempipaikka.
Järvellä on paljon saaria.
Helsinki on Suomen pääkaupunki.
Kävimme viikonloppuna mökillä.
Tämä on todella hyvä idea.
Hyvää yötä ja kauniita unia.
Puhutko englantia?
""",
    "nl": """
Hallo! Hoe gaat het met je?
Ik heb 3 appels en 12 peren gekocht op de markt.
De vergadering begint om 14.30 uur.
In 1830 werd België onafhankelijk.
Het kaartje kost € 12,50.
Ze zei: 'Ik kom morgen.'
Mijn broer (de oudste) woont in Utrecht.
Tot ziens op 27 april 2025.
Let op: de winkel is op zondag gesloten; hij gaat maandag open.
Ik weet het niet... misschien morgen.
We hebben de voetbalwedstrijd in het stadion gezien.
Ik heb een e-mail naar mijn baas gestuurd.
Ja.
Nee!
Wat?
Nederland heeft ongeveer 17.900.000 inwoners.
Het is vandaag 18 graden.
Ongeveer 20 % van de leerlingen was afwezig.
De kinderen speelden in de tuin terwijl de ouders kookten.
Waar is het dichtstbijzijnde treinstation?
Een kopje koffie, alstublieft.
Bel me op 06-12345678.
De film — erg lang — eindigde laat.
Ze werken bij een softwarebedrijf.
Wat een mooie dag!
Ik heb brood, melk, eieren en kaas nodig.
De trein vertrekt om 8.15 uur.
Jan, kom je of niet?
Ik ben moe; ik ga slapen.
Dat restaurant is duur: 75 euro per persoon.
Ze las "Het Achterhuis" in een week.
Het was een gezellige avond.
De fiets staat bij de gracht.
Amsterdam is de hoofdstad van Nederland.
Scheveningen ligt aan zee.
Ik hou van stroopwafels en drop.
Dit is een echte win-winsituatie.
Goedemorgen, meneer De Vries.
""",
    "sv": """
Hej! Hur mår du idag?
Jag köpte 3 äpplen och 12 päron på torget.
Mötet börjar klockan 14.30.
År 1523 blev Gustav Vasa kung.
Biljetten kostar 95,50 kr.
Hon sa: ”Jag kommer i morgon.”
Min bror (den äldste) bor i Göteborg.
Vi ses den 6 juni 2025.
Observera: butiken är stängd på söndagar; den öppnar på måndag.
Jag vet inte... kanske i morgon.
Vi såg fotbollsmatchen på arenan.
Jag skickade ett mejl till min chef.
Ja.
Nej!
Vad?
Sverige har ungefär 10 500 000 invånare.
Det är 22 grader idag.
Ungefär 10 % av eleverna var frånvarande.
Barnen lekte i trädgården medan föräldrarna lagade mat.
Var ligger närmaste tågstation?
En kopp kaffe, tack.
Ring mig på 070-123 45 67.
Filmen — väldigt lång — slutade sent.
De jobbar på ett mjukvaruföretag.
Vilken underbar dag!
Jag behöver bröd, mjölk, ägg och ost.
Tåget går klockan 8.10.
Erik, kommer du eller inte?
Jag är trött; jag går och lägger mig.
Restaurangen är dyr: 500 kronor per person.
Hon läste "Pippi Långstrump" på en dag.
Vi fikar varje eftermiddag.
Sjuksköterskan skötte sju sjösjuka sjömän.
Stockholm är Sveriges huvudstad.
Midsommar firas i juni.
Hus, sju och ljus.
Det var en riktigt bra weekend.
Tusen tack för hjälpen!
""",
    "sw": """
Habari! Habari za asubuhi?
Nilinunua machungwa 3 na ndizi 12 sokoni.
Mkutano unaanza saa 8:30 mchana.
Kenya ilipata uhuru mwaka 1963.
Tiketi inagharimu shilingi 1,500.
Alisema: "Nitakuja kesho."
Kaka yangu (mkubwa) anaishi Nairobi.
Tutaonana tarehe 12 Desemba 2025.
Tahadhari: duka limefungwa Jumapili; linafunguliwa Jumatatu.
Sijui... labda kesho.
Tuliangalia mechi ya mpira uwanjani.
Nimetuma email kwa bosi wangu.
Ndiyo.
Hapana!
Nini?
Tanzania ina watu takriban 65,000,000.
Leo kuna nyuzi 30 za joto.
Karibu 20 % ya wanafunzi hawakuja.
Watoto walicheza nje wakati wazazi walipika chakula.
Kituo cha treni kiko wapi?
Kikombe cha chai, tafadhali.
Nipigie simu kwa 0712 345 678.
Filamu — ndefu sana — iliisha usiku.
Wanafanya kazi katika kampuni ya teknolojia.
Siku nzuri kama nini!
Ninahitaji mkate, maziwa, mayai na jibini.
Treni inaondoka saa 2 asubuhi.
Juma, unakuja au la?
Nimechoka; naenda kulala.
Mgahawa huo ni ghali: dola 30 kwa mtu.
Alisoma kitabu "Kinjeketile" kwa wiki moja.
Hakuna matata.
Asante sana kwa msaada wako.
Dar es Salaam ni mji mkubwa.
Mlima Kilimanjaro ni mrefu kuliko yote Afrika.
Pole pole ndio mwendo.
Simba ni mfalme wa pori.
Karibu tena!
""",
    "tr": """
Merhaba! Nasılsın?
Pazardan 3 elma ve 12 armut aldım.
Toplantı saat 14.30'da başlıyor.
Türkiye Cumhuriyeti 1923'te kuruldu.
Bilet 125,50 TL.
O dedi ki: "Yarın geleceğim."
Ağabeyim (en büyüğü) İstanbul'da yaşıyor.
29 Ekim 2025'te görüşürüz.
Dikkat: mağaza pazar günleri kapalı; pazartesi açılıyor.
Bilmiyorum... belki yarın.
Futbol maçını stadyumda izledik.
Patronuma bir e-posta gönderdim.
Evet.
Hayır!
Ne?
Türkiye'nin nüfusu yaklaşık 85.000.000'dur.
Bugün hava 28 derece.
Öğrencilerin yaklaşık %20'si gelmedi.
Çocuklar bahçede oynarken anne babaları yemek pişirdi.
En yakın tren istasyonu nerede?
Bir çay, lütfen.
Beni 0532 123 45 67'den ara.
Film — çok uzun — geç bitti.
Bir yazılım şirketinde çalışıyorlar.
Ne güzel bir gün!
Ekmek, süt, yumurta ve peynir lazım.
Tren sabah 8'de kalkıyor.
Ahmet, geliyor musun, gelmiyor musun?
Yoruldum; uyumaya gidiyorum.
O restoran pahalı: kişi başı 1000 lira.
"Çalıkuşu" romanını bir haftada okudu.
Iğdır ve Ilgaz, İzmir ve Isparta.
Şişli'de güzel bir kafe var.
Ankara Türkiye'nin başkentidir.
Çok teşekkür ederim!
Hafta sonu sinemaya gittik.
Ağaçlar yeşillendi.
Kahvaltıda simit yedik.
""",
    "ko": """
안녕하세요! 오늘 기분이 어떠세요?
시장에서 사과 3개와 배 12개를 샀어요.
회의는 오후 2시 30분에 시작합니다.
대한민국은 1948년에 정부를 수립했습니다.
표는 15,000원입니다.
그녀가 말했다: "내일 올게요."
제 형은 (가장 나이가 많은) 서울에 살아요.
2025년 10월 9일에 만나요.
주의: 가게는 일요일에 문을 닫습니다; 월요일에 엽니다.
모르겠어요... 아마 내일.
우리는 경기장에서 축구 경기를 봤어요.
저는 email을 보냈어요.
네.
아니요!
뭐?
한국의 인구는 약 51,000,000명입니다.
오늘은 영하 10도입니다.
학생의 약 30%가 결석했습니다.
아이들은 마당에서 놀고 부모님은 요리를 했어요.
가장 가까운 기차역이 어디예요?
커피 한 잔 주세요.
010-1234-5678로 전화해 주세요.
영화는 — 아주 길어서 — 늦게 끝났어요.
그들은 소프트웨어 회사에서 일해요.
정말 좋은 날이네요!
빵, 우유, 계란, 치즈가 필요해요.
기차는 오전 8시에 출발해요.
민수야, 올 거야 말 거야?
피곤해요; 자러 갈게요.
그 식당은 비싸요: 1인당 50,000원.
그녀는 "토지"를 일주일 만에 읽었어요.
감사합니다.
서울은 한국의 수도입니다.
김치찌개를 좋아해요.
주말에 영화관에 갔어요.
한글은 세종대왕이 만들었습니다.
Samsung과 LG는 한국 회사입니다.
잘 자요.
""",
}

# Texts a language gets beyond its sentences and GENERIC.
EXTRA = {
    # ड़ / ढ़ written with a separate nukta (U+0921/U+0922 + U+093C) instead of U+095C/U+095D
    "hi": ["सड़क और पढ़ाई।", "दौड़॥"],
}


def texts_for(lang: str) -> list[str]:
    sents = SENTENCES[lang].strip("\n").split("\n")
    paragraph = " ".join(sents[:8])            # one longer multi-sentence input
    everything = " ".join(sents)               # a long one (espeak cuts clauses at its buffer sizes)
    return sents + [paragraph, everything] + EXTRA.get(lang, []) + GENERIC


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check-state", action="store_true",
                    help="also compare with fresh espeak instances and reverse order")
    args = ap.parse_args()

    from kittenml.kittentts2_tiny.frontend import espeak, phonemize_v1, phonemize_v2
    from phonemizer.backend import EspeakBackend

    mods = {"v1": phonemize_v1, "v2": phonemize_v2}
    langs = {"v1": V1_LANGS, "v2": V2_LANGS}
    cases = {}
    for lang in V2_LANGS:
        cases[lang] = [{"text": t} for t in texts_for(lang)] + [{"text": t, "other_script": True}
                                                                for t in OTHER_SCRIPT]
    for version in ("v1", "v2"):
        mod = mods[version]
        for lang in langs[version]:
            g2p = mod.get_g2p(lang)
            for case in cases[lang]:
                case[version] = mod.phonemize_lang(g2p, case["text"], lang)

    if args.check_state:
        diffs = 0
        for version in ("v1", "v2"):
            mod = mods[version]
            for lang in langs[version]:
                voice = mod.ESPEAK_VOICE[lang]
                rev = espeak.EspeakG2P(language=voice)
                for case in reversed(cases[lang]):
                    if mod.phonemize_lang(rev, case["text"], lang) != case[version]:
                        diffs += 1
                        print(f"order-dependent: {version} {lang} {case['text']!r}", file=sys.stderr)
                for case in cases[lang][::7]:     # a fresh espeak copy per text is slow: every 7th text
                    fresh = espeak.EspeakG2P(language=voice)
                    if mod.phonemize_lang(fresh, case["text"], lang) != case[version]:
                        diffs += 1
                        print(f"state-dependent: {version} {lang} {case['text']!r}", file=sys.stderr)
        print(f"state check: {diffs} differences", file=sys.stderr)

    from importlib.metadata import version as pkg_version
    out = {
        "about": "Python kittenml phonemize_vN.phonemize_lang(get_g2p(lang), text, lang) for the espeak "
                 "languages; written by tools/kitten-tts-2-tiny/espeak_fixtures.py",
        "reference": {
            "kittenml": pkg_version("kittenml"),
            "misaki": pkg_version("misaki"),
            "phonemizer": pkg_version("phonemizer"),
            "espeakng_loader": pkg_version("espeakng_loader"),
            "espeak_ng": ".".join(str(v) for v in EspeakBackend.version()),
        },
        "versions": langs,
        "cases": cases,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    n = sum(len(cases[lang]) for version in langs for lang in langs[version])
    print(f"wrote {args.out} ({n} checks)")


if __name__ == "__main__":
    main()
