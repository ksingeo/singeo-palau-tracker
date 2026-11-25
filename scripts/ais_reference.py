"""AIS reference tables: MMSI Maritime Identification Digits -> flag, ship type
codes and navigational status (ITU-R M.1371)."""

_MID = """
201 Albania;202 Andorra;203 Austria;204 Portugal (Azores);205 Belgium;206 Belarus;207 Bulgaria;208 Vatican;
209 Cyprus;210 Cyprus;211 Germany;212 Cyprus;213 Georgia;214 Moldova;215 Malta;216 Armenia;218 Germany;
219 Denmark;220 Denmark;224 Spain;225 Spain;226 France;227 France;228 France;229 Malta;230 Finland;
231 Faroe Islands;232 United Kingdom;233 United Kingdom;234 United Kingdom;235 United Kingdom;236 Gibraltar;
237 Greece;238 Croatia;239 Greece;240 Greece;241 Greece;242 Morocco;243 Hungary;244 Netherlands;
245 Netherlands;246 Netherlands;247 Italy;248 Malta;249 Malta;250 Ireland;251 Iceland;252 Liechtenstein;
253 Luxembourg;254 Monaco;255 Portugal (Madeira);256 Malta;257 Norway;258 Norway;259 Norway;261 Poland;
262 Montenegro;263 Portugal;264 Romania;265 Sweden;266 Sweden;267 Slovakia;268 San Marino;269 Switzerland;
270 Czechia;271 Turkey;272 Ukraine;273 Russia;274 North Macedonia;275 Latvia;276 Estonia;277 Lithuania;
278 Slovenia;279 Serbia;301 Anguilla;303 United States (Alaska);304 Antigua and Barbuda;305 Antigua and Barbuda;
306 Curaçao / Sint Maarten;307 Aruba;308 Bahamas;309 Bahamas;310 Bermuda;311 Bahamas;312 Belize;314 Barbados;
316 Canada;319 Cayman Islands;321 Costa Rica;323 Cuba;325 Dominica;327 Dominican Republic;329 Guadeloupe;
330 Grenada;331 Greenland;332 Guatemala;334 Honduras;336 Haiti;338 United States;339 Jamaica;
341 Saint Kitts and Nevis;343 Saint Lucia;345 Mexico;347 Martinique;348 Montserrat;350 Nicaragua;351 Panama;
352 Panama;353 Panama;354 Panama;355 Panama;356 Panama;357 Panama;358 Puerto Rico;359 El Salvador;
361 Saint Pierre and Miquelon;362 Trinidad and Tobago;364 Turks and Caicos;366 United States;367 United States;
368 United States;369 United States;370 Panama;371 Panama;372 Panama;373 Panama;374 Panama;
375 Saint Vincent and the Grenadines;376 Saint Vincent and the Grenadines;377 Saint Vincent and the Grenadines;
378 British Virgin Islands;379 US Virgin Islands;401 Afghanistan;403 Saudi Arabia;405 Bangladesh;408 Bahrain;
410 Bhutan;412 China;413 China;414 China;416 Taiwan;417 Sri Lanka;419 India;422 Iran;423 Azerbaijan;425 Iraq;
428 Israel;431 Japan;432 Japan;434 Turkmenistan;436 Kazakhstan;437 Uzbekistan;438 Jordan;440 South Korea;
441 South Korea;443 Palestine;445 North Korea;447 Kuwait;450 Lebanon;451 Kyrgyzstan;453 Macao;455 Maldives;
457 Mongolia;459 Nepal;461 Oman;463 Pakistan;466 Qatar;468 Syria;470 United Arab Emirates;
471 United Arab Emirates;472 Tajikistan;473 Yemen;475 Yemen;477 Hong Kong;478 Bosnia and Herzegovina;
501 Adélie Land (France);503 Australia;506 Myanmar;508 Brunei;510 Micronesia (FSM);511 Palau;512 New Zealand;
514 Cambodia;515 Cambodia;516 Christmas Island;518 Cook Islands;520 Fiji;523 Cocos (Keeling) Islands;
525 Indonesia;529 Kiribati;531 Laos;533 Malaysia;536 Northern Mariana Islands;538 Marshall Islands;
540 New Caledonia;542 Niue;544 Nauru;546 French Polynesia;548 Philippines;550 Timor-Leste;553 Papua New Guinea;
555 Pitcairn;557 Solomon Islands;559 American Samoa;561 Samoa;563 Singapore;564 Singapore;565 Singapore;
566 Singapore;567 Thailand;570 Tonga;572 Tuvalu;574 Vietnam;576 Vanuatu;577 Vanuatu;578 Wallis and Futuna;
601 South Africa;603 Angola;605 Algeria;607 France (St Paul);608 Ascension;609 Burundi;610 Benin;611 Botswana;
612 Central African Republic;613 Cameroon;615 Congo;616 Comoros;617 Cabo Verde;618 France (Crozet);
619 Côte d'Ivoire;620 Comoros;621 Djibouti;622 Egypt;624 Ethiopia;625 Eritrea;626 Gabon;627 Ghana;629 Gambia;
630 Guinea-Bissau;631 Equatorial Guinea;632 Guinea;633 Burkina Faso;634 Kenya;635 France (Kerguelen);
636 Liberia;637 Liberia;638 South Sudan;642 Libya;644 Lesotho;645 Mauritius;647 Madagascar;649 Mali;
650 Mozambique;654 Mauritania;655 Malawi;656 Niger;657 Nigeria;659 Namibia;660 Réunion;661 Rwanda;662 Sudan;
663 Senegal;664 Seychelles;665 Saint Helena;666 Somalia;667 Sierra Leone;668 São Tomé and Príncipe;669 Eswatini;
670 Chad;671 Togo;672 Tunisia;674 Tanzania;675 Uganda;676 DR Congo;677 Tanzania;678 Zambia;679 Zimbabwe;
701 Argentina;710 Brazil;720 Bolivia;725 Chile;730 Colombia;735 Ecuador;740 Falkland Islands;745 French Guiana;
750 Guyana;755 Paraguay;760 Peru;765 Suriname;770 Uruguay;775 Venezuela
"""
MID = {int(x.split(" ", 1)[0]): x.split(" ", 1)[1] for x in _MID.replace("\n", "").split(";") if x.strip()}

NAV_STATUS = {0: "Under way (engine)", 1: "At anchor", 2: "Not under command", 3: "Restricted manoeuvrability",
              4: "Constrained by draught", 5: "Moored", 6: "Aground", 7: "Engaged in fishing",
              8: "Under way (sailing)", 11: "Towing astern", 12: "Pushing / towing alongside",
              14: "AIS-SART / emergency", 15: "Not defined"}


def flag_from_mmsi(mmsi: int | str | None) -> str | None:
    s = str(mmsi or "")
    if len(s) != 9 or not s.isdigit():
        return None
    if s.startswith("00"):          # coast station
        return MID.get(int(s[2:5]))
    if s.startswith("0"):           # group
        return MID.get(int(s[1:4]))
    if s.startswith(("111", "970", "972", "974")):
        return MID.get(int(s[3:6])) if s.startswith("111") else None
    if s.startswith(("98", "99")):  # craft associated with parent ship / aids to navigation
        return MID.get(int(s[2:5]))
    return MID.get(int(s[:3]))


def mmsi_kind(mmsi) -> str:
    s = str(mmsi or "")
    if s.startswith("99"):
        return "Aid to navigation"
    if s.startswith("00"):
        return "Coast station"
    if s.startswith("111"):
        return "SAR aircraft"
    if s.startswith("970"):
        return "AIS-SART"
    if s.startswith("972"):
        return "MOB device"
    if s.startswith("974"):
        return "EPIRB"
    if s.startswith("98"):
        return "Auxiliary craft"
    return "Vessel"


def ship_type(code: int | None) -> tuple[str, str]:
    """Return (category, detailed label) for an AIS ship-type code."""
    if code is None or code == 0:
        return "Unknown", "Not reported"
    c = int(code)
    if c == 30:
        return "Fishing", "Fishing"
    if c in (31, 32):
        return "Tug & service", "Towing"
    if c == 33:
        return "Tug & service", "Dredging / underwater ops"
    if c == 34:
        return "Tug & service", "Diving ops"
    if c == 35:
        return "Government & military", "Military ops"
    if c == 36:
        return "Pleasure & sailing", "Sailing"
    if c == 37:
        return "Pleasure & sailing", "Pleasure craft"
    if 40 <= c <= 49:
        return "Passenger", "High-speed craft"
    if c == 50:
        return "Tug & service", "Pilot vessel"
    if c == 51:
        return "Government & military", "Search and rescue"
    if c == 52:
        return "Tug & service", "Tug"
    if c == 53:
        return "Tug & service", "Port tender"
    if c == 54:
        return "Government & military", "Anti-pollution"
    if c == 55:
        return "Government & military", "Law enforcement"
    if c == 58:
        return "Government & military", "Medical transport"
    if c == 59:
        return "Government & military", "Non-combatant (RR Res. 18)"
    if 60 <= c <= 69:
        return "Passenger", "Passenger"
    if 70 <= c <= 79:
        return "Cargo", "Cargo"
    if 80 <= c <= 89:
        return "Tanker", "Tanker"
    if 20 <= c <= 29:
        return "Other", "Wing in ground"
    return "Other", "Other type"
