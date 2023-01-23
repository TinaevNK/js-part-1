const API_URL = 'https://restcountries.com/v3.1';

type TCountry = {
    name: {
        common: string;
        official: string;
        nativeName: {
            [lng: string]: {
                official: string;
                common: string;
            };
        };
    };
    cca3: string;
    capital: Array<string>;
    altSpellings: Array<string>;
    area: number;
    borders: Array<string>;
};

type AllTCountries = Record<string, TCountry>;

type SearchResult = {
    resultPaths: Array<string[]>;
    overLimit: boolean;
    message: string;
    requestData: { requestCounter: number; error: boolean };
};

async function getData<T>(url: string): Promise<T> {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        redirect: 'follow',
    });

    const result = await response.json();

    if (response.ok) {
        return result;
    }

    throw result;
}

// для преобразования базы в словарь вида caa3/данные страны. Используем для того, чтобы не бегать за странами на бэк
async function loadCountriesData(): Promise<AllTCountries> {
    const countries = await getData<TCountry[]>(`${API_URL}/all?fields=name&fields=cca3&fields=area`);

    return countries.reduce((result: AllTCountries, country: TCountry) => {
        result[country.cca3] = country;
        return result;
    }, {});
}

async function getBorders(code: string | undefined) {
    const borders = await getData<TCountry>(`${API_URL}/alpha/${code}?fields=borders`);

    return borders.borders;
}

// головная функция
async function search(from: string, to: string): Promise<SearchResult> {
    const searchData: SearchResult = {
        resultPaths: [], // результат отработки нашей функции, его мы будем парсить в дальнейшем
        overLimit: false, // если страны слишком далеко друг от друга - мы выведем в ответ информацию об этом
        message: '',
        requestData: { requestCounter: 0, error: false }, // счётчик запросов и флаг ошибки
    };

    const paths = [[from]];

    for await (const path of paths) {
        const rootPath = path.at(-1);
        // если мы находим наш путь
        if (rootPath === to) {
            searchData.resultPaths.push(path);
            // теперь поищем другие варианты, если они есть (тоже самое количество шагов)
            const pathNextIndex = paths.indexOf(path) + 1;
            if (paths[pathNextIndex]) {
                for (let i = pathNextIndex; i < paths.length; i++) {
                    if (paths[i].length === path.length) {
                        if (paths[i].at(-1) === to) {
                            searchData.resultPaths.push(paths[i]);
                        }
                    } else {
                        break;
                    }
                }
            }
            return searchData;
        }
        if (path.length > 10) {
            searchData.overLimit = true;
            searchData.message = 'Очень далеко... давай на самолёте?)';
            return searchData;
        }
        let borders;

        try {
            borders = await getBorders(rootPath);
        } catch (err: any) {
            searchData.message = err.message;
            searchData.requestData.error = true;
            return searchData;
        }

        searchData.requestData.requestCounter += 1;

        // фильтруем страны, чтобы не идти по кругу
        const nextBorders = borders.filter((border) => {
            for (let i = 0; i < paths.length; i++) {
                if (paths[i].at(-1) === border && paths[i].length <= path.length) {
                    return false;
                }
            }
            return true;
        });

        nextBorders.forEach((border) => {
            const newPath = path.concat(border);
            paths.push(newPath); // вот тут спрятано увеличения стека, путём мутирования paths
        });
    }

    searchData.message = 'К сожалению - ничего не нашлось :(';
    return searchData;
}

const form = document.getElementById('form') as HTMLFormElement;
const fromCountry = document.getElementById('fromCountry') as HTMLInputElement;
const toCountry = document.getElementById('toCountry') as HTMLInputElement;
const countriesList = document.getElementById('countriesList') as HTMLElement;
const submit = document.getElementById('submit') as HTMLButtonElement;
const output = document.getElementById('output') as HTMLElement;

// функция для блокировки/разблокировке полей ввода и кнопки сабмита
const tooggleForm = (bollean: boolean): void => {
    fromCountry.disabled = bollean;
    toCountry.disabled = bollean;
    submit.disabled = bollean;
};

(async () => {
    tooggleForm(true); // дизейблим кнопки во время запроса

    output.textContent = 'Loading…';

    let countriesData: AllTCountries; // вынес в отдельные константы т.к. дальше по коду будет использоваться (т.е. нельзя в {})

    try {
        countriesData = await loadCountriesData();
        output.textContent = '';
    } catch (err: any) {
        output.textContent = `Упс, произошла ошибка при обращении к серверу ${err.message}`;
        return;
    }

    // немного поменял код, чтобы дважды не делать Object.keys, ключи ещё понадобятся
    const countryCodes = Object.keys(countriesData);

    // Заполняем список стран для подсказки в инпутах
    countryCodes
        .sort((a, b) => countriesData[b].area - countriesData[a].area)
        .forEach((code) => {
            const option = document.createElement('option');
            option.value = countriesData[code].name.common;
            countriesList.appendChild(option);
        });

    tooggleForm(false); // делаем раздизейбл по окончании запроса

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        // функция для поиска нужного ключа cca3
        const getCountryCode = (contryFullName: string): string => {
            const code = countryCodes.find((cca3) => contryFullName === countriesData[cca3].name.common);
            return code || '';
        };
        // ниже подобие примитивной валидации, не дающей сделать запрос по пустому полю
        if (!fromCountry.value) {
            output.textContent = 'Поле "From" должно быть заполнено:)';
            fromCountry.focus();
        } else if (!toCountry.value) {
            output.textContent = 'Поле "To" должно быть заполнено:)';
            toCountry.focus();
        } else {
            (async () => {
                tooggleForm(true);

                output.textContent = 'Ищем оптимальные маршруты, подождите пожалуйста!';

                const [from, to] = [getCountryCode(fromCountry.value), getCountryCode(toCountry.value)];

                const resultOutput = await search(from, to); // вызов главной функции

                if (resultOutput.requestData.error) {
                    output.textContent = `Произошла ошибка при обращении к серверу ${resultOutput.message}`;
                } else if (resultOutput.overLimit) {
                    output.textContent = resultOutput.message;
                } else if (resultOutput.resultPaths.length) {
                    output.textContent = '';
                    resultOutput.resultPaths.forEach((path) => {
                        path.forEach((country, i) => {
                            path[i] = countriesData[country].name.common;
                        });
                        output.innerHTML += `${path.join(' → ')}<br/>`;
                    });
                    output.innerHTML += `Количество запросов к API: ${resultOutput.requestData.requestCounter}`;
                } else {
                    output.textContent = resultOutput.message;
                }

                tooggleForm(false);
            })();
        }
    });
})();
